import {gmailClient} from "./google";
export async function listNikkeiMessages(accessToken:string){const gmail=await gmailClient(accessToken);const r=await gmail.users.messages.list({userId:"me",q:'from:(@mx.nikkei.com)',maxResults:30});return r.data.messages??[]}
export async function getMessage(accessToken:string,id:string){const gmail=await gmailClient(accessToken);const r=await gmail.users.messages.get({userId:"me",id,format:"full"});return r.data}
function decodeBase64Url(s:string){return Buffer.from(s.replace(/-/g,"+").replace(/_/g,"/"),"base64").toString("utf8")}
export function extractMimeBody(payload:any):{html:string;text:string}{let html="",text="";const walk=(p:any)=>{if(!p)return;const mime=p.mimeType||"";if(p.body?.data){const v=decodeBase64Url(p.body.data);if(mime==="text/html"&&!html)html=v;if(mime==="text/plain"&&!text)text=v}for(const x of p.parts||[])walk(x)};walk(payload);return{html,text}}
export function header(message:any,name:string){return message.payload?.headers?.find((h:any)=>h.name?.toLowerCase()===name.toLowerCase())?.value||""}
