import {google} from "@googleapis/gmail";
import {GOOGLE_SCOPE,env} from "./config";
export function googleOAuth(){return new google.auth.OAuth2(env("GOOGLE_CLIENT_ID"),env("GOOGLE_CLIENT_SECRET"),env("GOOGLE_REDIRECT_URI"))}
export function authUrl(state:string){return googleOAuth().generateAuthUrl({access_type:"offline",prompt:"consent",scope:[GOOGLE_SCOPE],state})}
export async function exchangeCode(code:string){const c=googleOAuth();const {tokens}=await c.getToken(code);return tokens}
export async function refreshAccessToken(refreshToken:string){const c=googleOAuth();c.setCredentials({refresh_token:refreshToken});const r=await c.getAccessToken();return r.token||null}
export async function gmailClient(accessToken:string){const c=googleOAuth();c.setCredentials({access_token:accessToken});return google.gmail({version:"v1",auth:c})}
