// Build a synthetic search index so the UI can be run and tested without any
// real personal data. Everything here is generated; nothing is read from disk.
//
//   node scripts/seed-synthetic.cjs /tmp/otso-demo
//   OTSO_DATA_DIR=/tmp/otso-demo npm run dev
//
// Writes <dir>/otso/search.db with the same tables the indexer produces.
const D=require('better-sqlite3');
const fs=require('fs');const path=require('path');
const dir=process.argv[2];
if(!dir){console.error('usage: node scripts/seed-synthetic.cjs <data-dir>');process.exit(1)}
fs.mkdirSync(path.join(dir,'otso'),{recursive:true});
const p=path.join(dir,'otso','search.db');try{fs.unlinkSync(p)}catch{}
const db=new D(p);
db.exec(`CREATE VIRTUAL TABLE search_entries USING fts5(title,content,source,entry_type,action_type,object_type,category,content_rowid UNINDEXED,event_id UNINDEXED,external_id UNINDEXED,url UNINDEXED,ts UNINDEXED,visibility UNINDEXED,year UNINDEXED,month UNINDEXED,tokenize='porter unicode61',prefix='2 3 4');
CREATE TABLE search_entry_map(rowid INTEGER PRIMARY KEY,event_id TEXT NOT NULL UNIQUE,source TEXT NOT NULL,entry_type TEXT NOT NULL,ts INTEGER NOT NULL,visibility TEXT NOT NULL,year INTEGER NOT NULL,month TEXT NOT NULL);`);
let seed=42;const r=()=>{seed=(seed*1664525+1013904223)%4294967296;return seed/4294967296};
const pick=a=>a[Math.floor(r()*a.length)];
const adj=['Quiet','Electric','Paper','Northern','Slow','Golden','Hidden','Modular','Analog','Infinite','Borrowed','Local'];
const noun=['Rivers','Gardens','Machines','Letters','Archives','Signals','Maps','Kitchens','Libraries','Tides','Networks','Notebooks'];
const topics=['personal archives','static site generators','sourdough hydration','SQLite full-text search','bike routes upstate','typeface pairing','svelte runes','home networking','film photography','indie web protocols','ceramics glazes','reading queue'];
const S={
 lastfm:[9000,'listen',()=>[`${pick(adj)} ${pick(noun)} — The ${pick(noun)}`,`Album: ${pick(adj)} ${pick(noun)}`,null]],
 spotify:[5000,'stream',()=>[`${pick(adj)} ${pick(noun)} (Remastered)`,`Artist: The ${pick(adj)} ${pick(noun)}`,null]],
 safari:[7000,'visit',()=>{const t=pick(topics);return [`${t[0].toUpperCase()+t.slice(1)}: a practical guide to getting started | ${pick(adj)} ${pick(noun)} Blog`,`example.com/${t.replace(/ /g,'-')}`,`https://example.com/${t.replace(/ /g,'-')}`]}],
 timing:[4000,'activity',()=>[`${pick(['Xcode','Terminal','Figma','Ghostty','Safari','Zed'])} — ${pick(topics)}`,`${Math.ceil(r()*90)} minutes`,null]],
 github:[2500,'activity',()=>[`Fix ${pick(topics)} regression in example-org/${pick(noun).toLowerCase()}`,`Pushed 3 commits to main: refactor ${pick(topics)}, add tests, update the readme with new instructions`,`https://github.com/example-org/${pick(noun).toLowerCase()}`]],
 imessage:[3500,'message',()=>[`Chat with ${pick(['Alex','Sam','Jordan','Riley','Morgan'])} Example`,`are we still on for ${pick(['dinner','the show','coffee','the hike'])} on ${pick(['friday','saturday','sunday'])}? I can bring the ${pick(noun).toLowerCase()}`,null]],
 'apple-photos':[3000,'photo',()=>[`IMG_${1000+Math.floor(r()*8999)}.HEIC`,`${pick(['Brooklyn, NY','Hudson, NY','Lisbon','Tokyo','Mexico City'])} · ${pick(adj)} light`,null]],
 pinboard:[1800,'bookmark',()=>[`${pick(adj)} ${pick(noun)}: notes on ${pick(topics)}`,`tags: ${pick(topics).split(' ').join(' ')} toread`,`https://example.org/${pick(noun).toLowerCase()}`]],
 arena:[1200,'block',()=>[`${pick(adj)} ${pick(noun)}`,`Channel: ${pick(topics)}`,`https://example.net/block/${Math.floor(r()*1e6)}`]],
 readwise:[1500,'highlight',()=>[`${pick(adj)} ${pick(noun)} by A. Author`,`“The thing about ${pick(topics)} is that it rewards patience more than cleverness, and most people give up a week too early.”`,null]],
 'twitter-mockuser':[2200,'tweet',()=>[`thinking about ${pick(topics)} again`,`thinking about ${pick(topics)} again. what if the ${pick(noun).toLowerCase()} were the point all along`,`https://example.com/status/${Math.floor(r()*1e9)}`]],
 things:[900,'task',()=>[`${pick(['Renew','Email','Fix','Order','Draft','Call'])} ${pick(noun).toLowerCase()} for ${pick(topics)}`,`Project: ${pick(adj)} ${pick(noun)}`,null]],
 calendar:[700,'event',()=>[`${pick(['Dinner','Studio visit','Standup','Dentist','Reading group'])} — ${pick(adj)} ${pick(noun)}`,`${pick(['1h','30m','2h'])} at ${pick(['home','the studio','Example Cafe'])}`,null]],
 foursquare:[600,'checkin',()=>[`${pick(adj)} ${pick(noun)} ${pick(['Cafe','Bar','Books','Park'])}`,`${pick(['Brooklyn, NY','Hudson, NY','Lisbon'])}`,null]],
 'apple-notes':[800,'note',()=>[`${pick(adj)} ${pick(noun)} — ideas`,`- look into ${pick(topics)}\n- ask about ${pick(topics)}\n- ${pick(adj).toLowerCase()} ${pick(noun).toLowerCase()}`,null]],
 notion:[400,'page',()=>[`${pick(topics)} — working notes`,`Summary of what I learned about ${pick(topics)} this week.`,null]],
 claude:[1100,'conversation',()=>[`Help with ${pick(topics)}`,`Can you help me think through ${pick(topics)}? I have a rough plan but I am unsure about the tradeoffs.`,null]],
 'apple-podcasts':[500,'listen',()=>[`Ep. ${Math.ceil(r()*300)}: ${pick(adj)} ${pick(noun)}`,`The ${pick(noun)} Show`,null]],
 linkedin:[200,'connection',()=>[`${pick(['Alex','Sam','Jordan'])} Example`,`${pick(['Designer','Engineer','Editor'])} at Example Co`,null]],
};
const ins=db.prepare(`INSERT INTO search_entries(rowid,title,content,source,entry_type,action_type,object_type,category,content_rowid,event_id,external_id,url,ts,visibility,year,month) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
const map=db.prepare(`INSERT INTO search_entry_map VALUES(?,?,?,?,?,?,?,?)`);
const t0=Date.UTC(2009,2,1)/1000,t1=Date.UTC(2026,10,27)/1000;let id=0;
db.transaction(()=>{for(const [src,[n,et,g]] of Object.entries(S)){const start=t0+r()*0.5*(t1-t0);for(let i=0;i<n;i++){id++;const u=Math.pow(r(),0.6);const ts=Math.floor(start+u*(t1-start));const d=new Date(ts*1000);const m=`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;const [title,content,url]=g();ins.run(id,title,content,src,et,et,'thing','x',id,'e'+id,'x'+id,url,ts,'private',d.getUTCFullYear(),m);map.run(id,'e'+id,src,et,ts,'private',d.getUTCFullYear(),m);}}})();
console.log(`${id} synthetic records written to ${p}`);
