import {createHmac,randomBytes,timingSafeEqual} from "node:crypto";
import {cookies} from "next/headers";
import {env} from "./config";
const name="nn_oauth_state";
function sign(v:string){return createHmac("sha256",env("SESSION_SECRET")).update(v).digest("hex")}
export async function setOAuthState(){const value=randomBytes(24).toString("hex");(await cookies()).set(name,`${value}.${sign(value)}`,{httpOnly:true,secure:true,sameSite:"lax",maxAge:600,path:"/"});return value}
export async function verifyOAuthState(value:string){const raw=(await cookies()).get(name)?.value; if(!raw)return false; const [v,s]=raw.split("."); if(v!==value||!s)return false; const expected=sign(v);return timingSafeEqual(Buffer.from(s),Buffer.from(expected))}
export async function clearOAuthState(){(await cookies()).delete(name)}
