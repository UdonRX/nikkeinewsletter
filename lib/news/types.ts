export type NewsCategory = "politics"|"economy"|"business"|"international"|"market"|"technology"|"science"|"society"|"life"|"other";
export type News = { id?:string; title:string; body:string; url?:string; index:number; imageUrl?:string; imageAlt?:string; source?:string; category?:string; tags?:string[]; importanceScore?:number; trendScore?:number; importanceStars?:number; publishedAt?:string; trendBadges?:string[]; topicId?:string; };
export type Email = { id:string; subject:string; receivedAt:string; internalDate:string; issueDate?:string; kind:"朝刊"|"昼刊"|"夕刊"|"速報"; from:string; newsCount:number; news:News[]; };
export type ReaderData = { title:string; imageUrl?:string; contentHtml:string; url:string; available:boolean; paywalled?:boolean; source?:string; };
