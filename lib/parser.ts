import {JSDOM } from "jsdom";
export type ParsedNews={title:string;body:string;url?:string;index:number};
const BAD=/配信停止|配信解除|unsubscribe|お問い合わせ|プライバシー|日経電子版について|Copyright|facebook|twitter|x\.com|instagram/i;
const URL_OK=/^https?:\\/\\/(?:[^\\s"']*\\.)?nikkei\\.com\\//i;
function clean(s:string){return s.replace(/\\s+/g," ").replace(/\\u00a0/g," ").trim()}
function scoreTitle(s:string){const n=s.length;return n>=8&&n<=120?(n>15?3:2):0}
export function parseNikkeiEmail(html:string,textFallback:string):ParsedNews[]{
  if(!html)return parseText(textFallback);
  const doc=new JSDOM(html).window.document;
  for(const el of Array.from(doc.querySelectorAll("script,style,noscript,form")))el.remove();
  const candidates:Array<{el:Element,title:string,url:string,body:string,score:number,order:number}>=Array.from(doc.querySelectorAll("a[href]")).map((a,order)=>{
    const title=clean(a.textContent||"");const href=a.getAttribute("href")||"";
    if(!URL_OK.test(href)||!scoreTitle(title)||BAD.test(title))return null;
    let el:Element=a;for(let i=0;i<4&&el.parentElement;i++)el=el.parentElement;
    const body=clean((el.textContent||"").replace(title,""));
    return {el,title,url:href,body,score:scoreTitle(title)+(body.length>=25?2:0)+(body.length>=80?1:0),order};
  }).filter(Boolean) as any;
  candidates.sort((a,b)=>a.order-b.order);
  const out:ParsedNews[]=[];const seen=new Set<string>();
  for(const c of candidates){
    const key=c.title+"|"+c.url;if(seen.has(key)||BAD.test(c.body))continue;
    seen.add(key);out.push({index:out.length,title:c.title,body:c.body,url:c.url});
  }
  return out.slice(0,100);
}
function parseText(t:string){const lines=t.split(/\\r?\\n/).map(clean).filter(Boolean);const out:ParsedNews[]=[];for(let i=0;i<lines.length;i++){const m=lines[i].match(/(https?:\\/\\/\\S+)/);if(m&&URL_OK.test(m[1])){const title=clean(lines[i-1]||"");const body=clean(lines[i-2]||"");if(title.length>=8&&!BAD.test(title))out.push({index:out.length,title,body,url:m[1]})}}return out.slice(0,100)}
