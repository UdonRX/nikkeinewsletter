import { NextRequest, NextResponse } from "next/server";
import { JSDOM } from "jsdom";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_HOSTS=["afpbb.com","fnn.jp","newsdig.tbs.co.jp","news.mynavi.jp","itmedia.co.jp","rss.itmedia.co.jp","nikkei.com"];

function allowedHost(hostname:string){const h=hostname.toLowerCase();return ALLOWED_HOSTS.some(x=>h===x||h.endsWith("."+x));}
function escapeHtml(v:string){return v.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");}
function textToHtml(text:string){return text.split(/\n+/).map(x=>x.trim()).filter(Boolean).map(x=>"<p>"+escapeHtml(x)+"</p>").join("");}
function jsonLdArticle(doc:Document){for(const s of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))){try{const raw=JSON.parse(s.textContent||"");const list=Array.isArray(raw)?raw:raw["@graph"]||[raw];for(const item of list){if(!item||typeof item!=="object")continue;const type=Array.isArray(item["@type"])?item["@type"].join(" "):String(item["@type"]||"");if(/NewsArticle|Article/i.test(type)&&typeof item.articleBody==="string")return{body:item.articleBody,image:Array.isArray(item.image)?item.image[0]:item.image,headline:typeof item.headline==="string"?item.headline:""};}}catch{}}return null;}
function sanitize(html:string,baseUrl:string){
  const doc=new JSDOM("<main>"+html+"</main>").window.document;
  for(const el of Array.from(doc.querySelectorAll(`script,style,noscript,nav,header,footer,aside,form,iframe,video,svg,figure figcaption,[class*='share'],[class*='social'],[class*='author'],[class*='date'],[class*='time'],[class*='meta'],[class*='related'],[class*='recommend'],[class*='ranking'],[class*='breadcrumb'],[class*='advert'],[id*='share'],[id*='social'],[id*='author'],[id*='date'],[id*='related'],[id*='recommend'],[id*='breadcrumb'],[id*='advert']`)){el.remove();}
  for(const el of Array.from(doc.querySelectorAll("*"))){
    for(const attr of Array.from(el.attributes)){
      const n=attr.name.toLowerCase(),v=attr.value;
      if(n.startsWith("on")||n==="srcdoc"){el.removeAttribute(attr.name);continue;}
      if(n==="href"||n==="src"){if(/^javascript:/i.test(v))el.removeAttribute(attr.name);else{try{el.setAttribute(attr.name,new URL(v,baseUrl).toString());}catch{el.removeAttribute(attr.name);}}}
    }
  }
  return doc.querySelector("main")?.innerHTML||"";
}
function trimPaywall(text:string){const markers=["この記事は有料会員限定","有料会員限定記事","有料会員登録をすることで閲覧できます"];const p=markers.map(x=>text.indexOf(x)).filter(x=>x>=0);return p.length?{text:text.slice(0,Math.min(...p)).trim(),paywalled:true}:{text,paywalled:false};}

export async function GET(req:NextRequest){
  const rawUrl=req.nextUrl.searchParams.get("url"),fallbackTitle=req.nextUrl.searchParams.get("title")||"",fallbackBody=req.nextUrl.searchParams.get("body")||"";
  if(!rawUrl)return NextResponse.json({error:"url_required"},{status:400});
  let url:URL;try{url=new URL(rawUrl);}catch{return NextResponse.json({error:"invalid_url"},{status:400});}
  if(url.protocol!=="https:"||!allowedHost(url.hostname))return NextResponse.json({error:"unsupported_url"},{status:400});
  try{
    const response=await fetch(url,{redirect:"follow",headers:{"User-Agent":"NikkeiNewsReader/1.0 RSS reader","Accept":"text/html,application/xhtml+xml","Accept-Language":"ja-JP,ja;q=0.9,en;q=0.8"},cache:"no-store"});
    if(!response.ok)return NextResponse.json({title:fallbackTitle,imageUrl:"",contentHtml:textToHtml(fallbackBody),url:url.toString(),available:Boolean(fallbackBody),paywalled:false,source:"rss_fallback"});
    const finalUrl=new URL(response.url||url.toString());
    if(!allowedHost(finalUrl.hostname))return NextResponse.json({title:fallbackTitle,imageUrl:"",contentHtml:textToHtml(fallbackBody),url:url.toString(),available:Boolean(fallbackBody),paywalled:false,source:"rss_fallback"});
    const doc=new JSDOM(await response.text()).window.document;
    const structured=jsonLdArticle(doc);
    const ogTitle=doc.querySelector('meta[property="og:title"]')?.getAttribute("content")||"";
    const ogImage=doc.querySelector('meta[property="og:image"]')?.getAttribute("content")||"";
    const title=structured?.headline||ogTitle||doc.querySelector("h1")?.textContent?.trim()||fallbackTitle;
    const imageRaw=typeof structured?.image==="string"?structured.image:(structured?.image as any)?.url||ogImage;
    const imageUrl=imageRaw?new URL(imageRaw,finalUrl).toString():"";
    if(structured?.body){const t=trimPaywall(structured.body);return NextResponse.json({title,imageUrl,contentHtml:textToHtml(t.text),url:finalUrl.toString(),available:Boolean(t.text),paywalled:t.paywalled,source:"public_article"});}
    const candidates=['[itemprop="articleBody"]','article','main',[...doc.querySelectorAll("div")].sort((a,b)=>(b.textContent?.length||0)-(a.textContent?.length||0))[0]?.tagName==="DIV"?".article-body":""].filter(Boolean) as string[];
    let bodyHtml="";for(const selector of candidates){const el=doc.querySelector(selector);if(el&&((el.textContent?.trim().length||0)>=200)){bodyHtml=sanitize(el.innerHTML,finalUrl.toString());break;}}
    if(bodyHtml)return NextResponse.json({title,imageUrl,contentHtml:bodyHtml,url:finalUrl.toString(),available:true,paywalled:false,source:"public_article"});
    return NextResponse.json({title,imageUrl,contentHtml:textToHtml(fallbackBody),url:finalUrl.toString(),available:Boolean(fallbackBody),paywalled:false,source:"rss_fallback"});
  }catch{return NextResponse.json({title:fallbackTitle,imageUrl:"",contentHtml:textToHtml(fallbackBody),url:url.toString(),available:Boolean(fallbackBody),paywalled:false,source:"rss_fallback"});}
}
