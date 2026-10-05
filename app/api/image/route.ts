import { NextRequest, NextResponse } from "next/server";

export const runtime="nodejs";
export const dynamic="force-dynamic";

const ALLOWED_HOSTS=["afpbb.com","fnn.jp","newsdig.tbs.co.jp","news.mynavi.jp","itmedia.co.jp","rss.itmedia.co.jp","nikkei.com","yahoo.co.jp","gigazine.net","webtan.impress.co.jp","news.google.com","googleusercontent.com"];

function allowedHost(hostname:string){
  const h=hostname.toLowerCase();
  return ALLOWED_HOSTS.some(x=>h===x||h.endsWith("."+x));
}

export async function GET(req:NextRequest){
  const raw=req.nextUrl.searchParams.get("url");
  if(!raw)return new NextResponse("url_required",{status:400});
  let url:URL;
  try{url=new URL(raw);}catch{return new NextResponse("invalid_url",{status:400});}
  if(!["http:","https:"].includes(url.protocol)||!allowedHost(url.hostname))return new NextResponse("unsupported_url",{status:400});
  try{
    const response=await fetch(url,{redirect:"follow",cache:"no-store",headers:{
      "User-Agent":"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
      "Accept":"image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      "Referer":url.origin+"/"
    }});
    if(!response.ok||!response.body)return new NextResponse("image_fetch_failed",{status:502});
    const finalUrl=new URL(response.url||url.toString());
    if(!allowedHost(finalUrl.hostname))return new NextResponse("image_redirect_not_allowed",{status:403});
    const contentType=response.headers.get("content-type")||"";
    if(!contentType.toLowerCase().startsWith("image/"))return new NextResponse("not_image",{status:415});
    return new NextResponse(response.body,{status:200,headers:{
      "Content-Type":contentType,
      "Cache-Control":"public, max-age=3600, s-maxage=86400"
    }});
  }catch{
    return new NextResponse("image_fetch_failed",{status:502});
  }
}
