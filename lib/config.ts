export const GOOGLE_SCOPE="https://www.googleapis.com/auth/gmail.readonly";
export function env(name:string){const v=process.env[name];if(!v)throw new Error(`Missing environment variable: ${name}`);return v}
