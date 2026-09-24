import {cookies} from "next/headers";
import {createCipheriv,createDecipheriv,createHmac,randomBytes,timingSafeEqual} from "node:crypto";
import {env} from "./config";
const stateName="nn_oauth_state", refreshName="nn_refresh_token";
const key=()=>Buffer.from(createHmac("sha256",env("SESSION_SECRET")).update("nikkei-refresh").digest("hex"),"hex");
function sign(v:string){return createHmac("sha256",env("SESSION_SECRET")).update(v).digest("hex")}
export async function setOAuthState(){const value=randomBytes(24).toString("hex");(await cookies()).set(stateName,`${value}.${sign(value)}`,{httpOnly:true,secure:true,sameSite:"lax",maxAge:600,path:"/"});return value}
export async function verifyOAuthState(value:string){const raw=(await cookies()).get(stateName)?.value;if(!raw)return false;const [v,s]=raw.split(".");if(v!==value||!s)return false;const expected=sign(v);return timingSafeEqual(Buffer.from(s),Buffer.from(expected))}
export async function clearOAuthState(){(await cookies()).delete(stateName)}
export function encryptRefreshToken(value:string){const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",key(),iv);const data=Buffer.concat([cipher.update(value,"utf8"),cipher.final()]);return [iv.toString("base64url"),cipher.getAuthTag().toString("base64url"),data.toString("base64url")].join(".")}
export function decryptRefreshToken(value:string){const [iv,tag,data]=value.split(".");if(!iv||!tag||!data)throw new Error("bad session");const decipher=createDecipheriv("aes-256-gcm",key(),Buffer.from(iv,"base64url"));decipher.setAuthTag(Buffer.from(tag,"base64url"));return Buffer.concat([decipher.update(Buffer.from(data,"base64url")),decipher.final()]).toString("utf8")}
export async function setRefreshToken(token:string){(await cookies()).set(refreshName,encryptRefreshToken(token),{httpOnly:true,secure:true,sameSite:"lax",maxAge:60*60*24*180,path:"/"})}
export async function getRefreshToken(){const v=(await cookies()).get(refreshName)?.value;return v?decryptRefreshToken(v):null}
export async function setAccessToken(token:string){(await cookies()).set("nn_access_token",token,{httpOnly:true,secure:true,sameSite:"lax",maxAge:3500,path:"/"})}
