import {NextResponse} from "next/server";import {authUrl} from "@/lib/google";import {setOAuthState} from "@/lib/session";
export async function GET(){const state=await setOAuthState();return NextResponse.redirect(authUrl(state))}
