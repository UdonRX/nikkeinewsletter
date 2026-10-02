import { NextRequest, NextResponse } from "next/server";
import { JSDOM } from "jsdom";

export const runtime="nodejs";
export const dynamic="force-dynamic";

const ALLOWED=["afpbb.com","newsdig.tbs.co.jp","news.mynavi.jp","itmedia.co.jp","rss.itmedia.co.jp"];
function allowedHost(h:string){const x=h.toLowerCase();return ALLOWED.some(v=>x===v||x.endsWith("."+v));}

export async function GET(req:NextRequest){
  const raw=req.nextUrl.searchParams.get("url");if(!raw)return new NextResponse("url_required",{status:400});
  let u:URL;try{u=new URL(raw);}catch{return new NextResponse("invalid_url",{status:400});}
  if(u.protocol!=="https:"||!allowedHost(u.hostname))return new NextResponse("unsupported_url",{status:400});
  try{
    const page=await fetch(u,{redirect:"follow",headers:{"User-Agent":"NikkeiNewsReader/1.0 RSS reader","Accept":"text/html,application/xhtml+xml"},cache:"no-store"});
    if(!page.ok)return new NextResponse("article_fetch_failed",{status:502});
    const finalUrl=new URL(page.url||u.toString());if(!allowedHost(finalUrl.hostname))return new NextResponse("bad_redirect",{status:400});
    const doc=new JSDOM(await page.text()).window.document;
    const rawImage=doc.querySelector('meta[property="og:image"]')?.getAttribute("content")||doc.querySelector('meta[name="twitter:image"]')?.getAttribute("content")||"";
    if(!rawImage)return new NextResponse("image_not_found",{status:404});
    const imageUrl=new URL(rawImage,finalUrl);if(imageUrl.protocol!=="https:"||!allowedHost(imageUrl.hostname))return new NextResponse("unsupported_image_host",{status:400});
    const image=await fetch(imageUrl,{redirect:"follow",headers:{"User-Agent":"NikkeiNewsReader/1.0 RSS reader","Accept":"image/avif,image/webp,image/apng,image/*,*/*;q=0.8","Referer":finalUrl.toString()},cache:"no-store"});
    if(!image.ok)return new NextResponse("image_fetch_failed",{status:502});
    const finalImage=new URL(image.url||imageUrl.toString());if(!allowedHost(finalImage.hostname))return new NextResponse("bad_image_redirect",{status:400});
    const type=image.headers.get("content-type")||"image/jpeg";if(!type.startsWith("image/"))return new NextResponse("not_image",{status:502});
    return new NextResponse(await image.arrayBuffer(),{status:200,headers:{"Content-Type":type,"Cache-Control":"public,max-age=86400,s-maxage=86400"}});
  }catch{return new NextResponse("image_fetch_failed",{status:502});}
}
