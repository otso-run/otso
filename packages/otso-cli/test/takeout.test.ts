import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runIngest } from '../src/core/runner.js';
import { chatDate } from '../src/connectors/takeout/chat.js';
import { decodeWords, parseMessage, readMbox } from '../src/connectors/takeout/mime.js';
import { runTomlQueries, sandbox, writeFiles } from './helpers.js';

// Every name, address and number below is made up.
const tmp = () => mkdtempSync(join(tmpdir(), 'otso-takeout-'));

async function ingestTwice(id: string, input: string) {
  const [first] = await runIngest(id, [input]);
  const [second] = await runIngest(id, [input]);
  for (const s of Object.values(second.stats)) expect(s.inserted).toBe(0);
  return first;
}

const MBOX = [
  'From 1700000000000000001@xxx Mon Jan 15 10:30:00 +0000 2024',
  'X-GM-THRID: 1788000000000000001',
  'X-Gmail-Labels: Inbox,Important,Opened',
  'Message-ID: <plain-1@example.com>',
  'From: "Ada Example" <ada@example.com>',
  'To: Bob Example <bob@example.org>, carol@example.net',
  'Subject: =?UTF-8?B?Q2Fmw6k=?= plans',
  'Date: Mon, 15 Jan 2024 10:30:00 +0000 (UTC)',
  'Content-Type: text/plain; charset=UTF-8',
  'Content-Transfer-Encoding: quoted-printable',
  '',
  'Let=E2=80=99s meet at the caf=C3=A9 on Friday.',
  '>From the other email: bring the zine.',
  '',
  'From 1700000000000000002@xxx Tue Jan 16 08:00:00 +0000 2024',
  'X-Gmail-Labels: Archived',
  'Message-ID: <multi-2@example.com>',
  'From: bob@example.org',
  'To: ada@example.com',
  'Subject: Re: plans',
  'Date: Tue, 16 Jan 2024 03:00:00 -0500',
  'MIME-Version: 1.0',
  'Content-Type: multipart/mixed; boundary="outer"',
  '',
  'This is a multi-part message in MIME format.',
  '--outer',
  'Content-Type: multipart/alternative; boundary="alt"',
  '',
  '--alt',
  'Content-Type: text/html; charset=iso-8859-1',
  'Content-Transfer-Encoding: base64',
  '',
  Buffer.from('<p>Sounds good, see you at the <b>caf\xe9</b>.</p>', 'latin1').toString('base64'),
  '--alt--',
  '--outer',
  'Content-Type: application/pdf; name="map.pdf"',
  'Content-Disposition: attachment; filename="map.pdf"',
  'Content-Transfer-Encoding: base64',
  '',
  'JVBERi0xLjQKJcfsj6IKMSAwIG9iago=',
  '--outer--',
  '',
  'From 1700000000000000003@xxx Wed Jan 17 09:00:00 +0000 2024',
  'X-Gmail-Labels: Spam',
  'Message-ID: <spam-3@example.com>',
  'From: winner@example.com',
  'Subject: You won',
  'Date: Wed, 17 Jan 2024 09:00:00 +0000',
  '',
  'Claim now.',
  '',
].join('\r\n');

describe('mime helpers', () => {
  test('decodes encoded words, joining adjacent ones', () => {
    expect(decodeWords('=?UTF-8?B?Q2Fmw6k=?= plans')).toBe('Café plans');
    expect(decodeWords('=?iso-8859-1?Q?caf=E9?= =?iso-8859-1?Q?_au_lait?=')).toBe('café au lait');
  });

  test('prefers text/plain and lists attachment names without decoding them', () => {
    const msg = parseMessage(
      [
        'Content-Type: multipart/alternative; boundary=b',
        '',
        '--b',
        'Content-Type: text/plain',
        '',
        'plain words',
        '--b',
        'Content-Type: text/html',
        '',
        '<p>html words</p>',
        '--b--',
      ].join('\n')
    );
    expect(msg.text).toBe('plain words');
  });

  test('streams an mbox message by message and undoes >From quoting', async () => {
    const dir = writeFiles(tmp(), { 'a.mbox': MBOX });
    const raws: string[] = [];
    for await (const m of readMbox(join(dir, 'a.mbox'))) raws.push(m.raw);
    expect(raws).toHaveLength(3);
    expect(raws[0]).toContain('\nFrom the other email');
  });
});

describe('gmail (Takeout Mail mbox)', () => {
  test('indexes messages with text, people and attachments, and skips spam', async () => {
    const { sources } = sandbox();
    const dir = writeFiles(tmp(), { 'Takeout/Mail/All mail Including Spam and Trash.mbox': MBOX });
    const first = await ingestTwice('gmail', dir);
    expect(first.stats.messages.inserted).toBe(3);

    const rows = runTomlQueries('gmail', sources);
    expect(rows).toHaveLength(2);
    const plain = rows.find((r: any) => r.title === 'Café plans');
    expect(plain.content).toContain('Let’s meet at the café on Friday.');
    expect(plain.content).toContain('From: Ada Example <ada@example.com>');
    expect(plain.occurred_at).toBe('2024-01-15T10:30:00Z');
    expect(plain.url).toBe('https://mail.google.com/mail/u/0/#search/rfc822msgid%3Aplain-1%40example.com');
    expect(JSON.parse(plain.metadata).labels).toBe('Inbox,Important,Opened');

    const reply = rows.find((r: any) => r.title === 'Re: plans');
    expect(reply.content).toContain('see you at the café');
    expect(reply.content).toContain('map.pdf');
    expect(reply.content).not.toContain('JVBERi');
    expect(reply.occurred_at).toBe('2024-01-16T08:00:00Z');
  });

  test('explains what to pass when there is no mbox', async () => {
    sandbox();
    const dir = writeFiles(tmp(), { 'Takeout/Chrome/History.json': '{}' });
    await expect(runIngest('gmail', [dir])).rejects.toThrow(/Mail/);
  });
});

describe('google takeout: chat and voice', () => {
  test('chat dates in Takeout wording', () => {
    expect(chatDate('Tuesday, April 5, 2022 at 3:04:05 PM UTC')).toBe('2022-04-05T15:04:05Z');
    expect(chatDate('Monday, January 1, 2024 at 12:00:00 AM UTC')).toBe('2024-01-01T00:00:00Z');
  });

  test('google chat messages and google voice texts and calls', async () => {
    const { sources } = sandbox();
    const dir = writeFiles(tmp(), {
      'Takeout/Google Chat/Groups/Space AAAA1111/group_info.json': JSON.stringify({
        name: 'Zine club',
        members: [{ name: 'Ada Example', email: 'ada@example.com' }],
      }),
      'Takeout/Google Chat/Groups/Space AAAA1111/messages.json': JSON.stringify({
        messages: [
          { creator: { name: 'Ada Example', email: 'ada@example.com' }, created_date: 'Tuesday, April 5, 2022 at 3:04:05 PM UTC', text: 'Print run is Friday', message_id: 'AAAA1111/t1/t1' },
          { creator: { name: 'Bob Example' }, created_date: 'Tuesday, April 5, 2022 at 3:05:00 PM UTC', attached_files: [{ original_name: 'cover.png' }], message_id: 'AAAA1111/t1/t2' },
          { creator: { name: 'Bob Example' }, created_date: 'Tuesday, April 5, 2022 at 3:06:00 PM UTC', text: '', message_id: 'AAAA1111/t1/t3' },
        ],
      }),
      'Takeout/Google Chat/Groups/DM BBBB2222/group_info.json': JSON.stringify({
        members: [{ name: 'Carol Example', email: 'carol@example.net' }],
      }),
      'Takeout/Google Chat/Groups/DM BBBB2222/messages.json': JSON.stringify({
        messages: [{ creator: { name: 'Carol Example' }, created_date: 'Wednesday, April 6, 2022 at 9:00:00 AM UTC', text: 'hi!', message_id: 'BBBB2222/x/x' }],
      }),
      'Takeout/Voice/Calls/Dana Example - Text - 2023-03-01T15_04_05Z.html': `<html><body><div class="hChatLog hfeed">
<div class="message"><abbr class="dt" title="2023-03-01T10:04:05.000-05:00">Mar 1</abbr>:
<cite class="sender vcard"><a class="tel" href="tel:+15550100001"><span class="fn">Dana Example</span></a></cite>:
<q>Running late &amp; sorry</q></div>
<div class="message"><abbr class="dt" title="2023-03-01T10:05:00.000-05:00">Mar 1</abbr>:
<cite class="sender vcard"><a class="tel" href="tel:+15550100002"><abbr class="fn" title="">Me</abbr></a></cite>:
<q>No problem</q></div>
</div></body></html>`,
      'Takeout/Voice/Calls/Dana Example - Voicemail - 2023-03-02T12_00_00Z.html': `<html><body><div class="haudio">
<span class="fn">Voicemail from Dana Example</span>
<div class="contributor vcard">Voicemail from <a class="tel" href="tel:+15550100001"><span class="fn">Dana Example</span></a></div>
<abbr class="published" title="2023-03-02T07:00:00.000-05:00">Mar 2</abbr>
<abbr class="duration" title="PT26S">(00:00:26)</abbr>
<span class="description"><span class="full-text">Call me back about the print run</span></span>
</div></body></html>`,
      'Takeout/Voice/Calls/+15550100003 - Missed - 2023-03-03T12_00_00Z.html': `<div class="haudio"><div class="contributor vcard">Missed call from <a class="tel" href="tel:+15550100003"><span class="fn"></span></a></div>
<abbr class="published" title="2023-03-03T12:00:00.000Z">Mar 3</abbr></div>`,
    });
    const first = await ingestTwice('google-takeout', dir);
    expect(first.stats.google_chat.inserted).toBe(3);

    const chat = runTomlQueries('google-chat', sources);
    expect(chat.map((r: any) => r.title).sort()).toEqual([
      'Ada Example · Zine club',
      'Bob Example · Zine club',
      'Carol Example · DM with Carol Example',
    ]);
    expect(chat.find((r: any) => r.title.startsWith('Bob')).content).toBe('cover.png');
    expect(chat.find((r: any) => r.title.startsWith('Ada')).occurred_at).toBe('2022-04-05T15:04:05Z');

    const voice = runTomlQueries('google-voice', sources);
    expect(voice).toHaveLength(4);
    const late = voice.find((r: any) => r.content === 'Running late & sorry');
    expect(late).toMatchObject({ title: 'Dana Example', occurred_at: '2023-03-01T15:04:05Z' });
    expect(voice.find((r: any) => r.content === 'No problem').title).toBe('Me · Dana Example');
    const vm = voice.find((r: any) => r.title === 'Voicemail call: Dana Example');
    expect(vm).toMatchObject({ content: 'Call me back about the print run', occurred_at: '2023-03-02T12:00:00Z' });
    expect(JSON.parse(vm.metadata).duration_seconds).toBe('26');
    expect(voice.find((r: any) => r.title === 'Missed call: +15550100003')).toBeTruthy();
  });
});

describe('google takeout: places, gemini, activity, notebooklm, keep, contacts, blogger, groups, photos', () => {
  test('every product lands in a source the indexer can read', async () => {
    const { sources } = sandbox();
    const point = (lng: number, lat: number) => ({ type: 'Point', coordinates: [lng, lat] });
    const dir = writeFiles(tmp(), {
      'Takeout/Maps (your places)/Saved Places.json': JSON.stringify({
        type: 'FeatureCollection',
        features: [
          {
            geometry: point(-73.99, 40.73),
            properties: { date: '2023-05-01T12:00:00Z', google_maps_url: 'https://maps.google.com/?cid=1', location: { name: 'Example Books', address: '1 Example St' } },
          },
        ],
      }),
      'Takeout/Maps (your places)/Reviews.json': JSON.stringify({
        type: 'FeatureCollection',
        features: [
          {
            geometry: point(-73.98, 40.72),
            properties: { date: '2023-06-01T12:00:00Z', five_star_rating_published: 4, review_text_published: 'Great coffee', google_maps_url: 'https://maps.google.com/?cid=2', location: { name: 'Example Cafe' } },
          },
        ],
      }),
      'Takeout/Saved/Want to go.csv': 'Title,Note,URL,Comment\nExample Museum,rainy day,https://maps.google.com/?cid=3,\n',
      'Takeout/Location History (Timeline)/Semantic Location History/2019/2019_JANUARY.json': JSON.stringify({
        timelineObjects: [
          { placeVisit: { location: { name: 'Example Park', placeId: 'P1', latitudeE7: 407000000, longitudeE7: -739000000 }, duration: { startTimestamp: '2019-01-05T15:00:00Z', endTimestamp: '2019-01-05T16:00:00Z' } } },
          { activitySegment: { activityType: 'WALKING' } },
        ],
      }),
      'Takeout/My Activity/Gemini Apps/MyActivity.json': JSON.stringify([
        { header: 'Gemini Apps', title: 'Prompted how do I bind a zine', time: '2024-03-01T10:00:00Z', safeHtmlItem: [{ html: '<p>Use a <b>saddle stitch</b>.</p>' }] },
      ]),
      'Takeout/My Activity/Maps/MyActivity.json': JSON.stringify([
        { header: 'Maps', title: 'Searched for bookstores', titleUrl: 'https://www.google.com/maps/search/bookstores', time: '2024-03-02T10:00:00Z' },
      ]),
      'Takeout/My Activity/Ads/MyActivity.json': JSON.stringify([{ header: 'Ads', title: 'Saw an ad', time: '2024-03-02T10:00:00Z' }]),
      'Takeout/My Activity/Chrome/MyActivity.json': JSON.stringify([{ header: 'Chrome', title: 'Visited x', time: '2024-03-02T10:00:00Z' }]),
      'Takeout/NotebookLM/Zine research/Notes/Binding methods.html': '<html><body><h1>Binding methods</h1><p>Saddle stitch, perfect bound.</p></body></html>',
      'Takeout/NotebookLM/Zine research/Sources/scan.pdf': '%PDF-1.4',
      'Takeout/Keep/Groceries.json': JSON.stringify({
        title: 'Groceries',
        listContent: [{ text: 'oat milk', isChecked: false }, { text: 'bread', isChecked: true }],
        labels: [{ name: 'home' }],
        createdTimestampUsec: 1700000000000000,
        userEditedTimestampUsec: 1700000100000000,
      }),
      'Takeout/Keep/Old.json': JSON.stringify({ title: 'Trashed', textContent: 'gone', isTrashed: true, userEditedTimestampUsec: 1700000000000000 }),
      'Takeout/Contacts/All Contacts/All Contacts.vcf':
        'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Ada Example\r\nN:Example;Ada;;;\r\nEMAIL;TYPE=INTERNET:ada@example.com\r\nTEL;TYPE=CELL:+1 555 0100\r\nORG:Example Press\r\nEND:VCARD\r\n',
      'Takeout/Contacts/Friends/Friends.vcf':
        'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Ada Example\r\nN:Example;Ada;;;\r\nEMAIL;TYPE=INTERNET:ada@example.com\r\nTEL;TYPE=CELL:+1 555 0100\r\nORG:Example Press\r\nEND:VCARD\r\n',
      'Takeout/Blogger/Blogs/Example Blog/feed.atom': `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:blogger="http://schemas.google.com/blogger/2018">
<entry><id>tag:blogger.com,1999:blog-1.post-1</id><blogger:type>POST</blogger:type><blogger:status>LIVE</blogger:status>
<title>First post</title><content type="html">&lt;p&gt;Hello &amp;amp; welcome&lt;/p&gt;</content>
<link rel="alternate" type="text/html" href="https://example.blogspot.com/2010/01/first-post.html"/>
<author><name>Ada</name></author><published>2010-01-01T12:00:00.000Z</published><updated>2010-01-02T12:00:00.000Z</updated></entry>
<entry><id>tag:blogger.com,1999:blog-1.post-2</id><blogger:type>POST</blogger:type><blogger:status>DELETED</blogger:status><title>Gone</title><published>2010-02-01T12:00:00Z</published></entry>
<entry><id>tag:blogger.com,1999:blog-1.layout</id><blogger:type>LAYOUT</blogger:type><title>Template</title></entry>
</feed>`,
      'Takeout/Groups/Zine makers/messages.mbox': [
        'From 1@xxx Mon Jan 15 10:30:00 +0000 2024',
        'Message-ID: <g1@example.com>',
        'From: Bob Example <bob@example.org>',
        'Subject: Meetup',
        'Date: Mon, 15 Jan 2024 10:30:00 +0000',
        '',
        'See you Thursday.',
        '',
      ].join('\n'),
      'Takeout/Google Photos/Photos from 2021/IMG_0001.jpg.json': JSON.stringify({
        title: 'IMG_0001.jpg',
        description: 'Print day',
        photoTakenTime: { timestamp: '1620000000' },
        geoData: { latitude: 40.7, longitude: -73.9 },
        people: [{ name: 'Ada Example' }],
        url: 'https://photos.google.com/photo/AAA',
      }),
      'Takeout/Google Photos/Zine launch/IMG_0001.jpg.supplemental-metadata.json': JSON.stringify({
        title: 'IMG_0001.jpg',
        photoTakenTime: { timestamp: '1620000000' },
        url: 'https://photos.google.com/photo/AAA',
      }),
      'Takeout/Google Photos/Zine launch/metadata.json': JSON.stringify({ title: 'Zine launch' }),
      'Takeout/Google Photos/Zine launch/IMG_0001.jpg': 'not really a jpeg',
    });
    await ingestTwice('google-takeout', dir);

    const maps = runTomlQueries('google-maps', sources);
    expect(maps.map((r: any) => r.title).sort()).toEqual([
      'Example Books (Starred places)',
      'Example Museum (Want to go)',
      'Reviewed Example Cafe',
      'Visited Example Park',
    ]);
    expect(maps.find((r: any) => r.title === 'Reviewed Example Cafe').content).toContain('★★★★ Great coffee');
    expect(maps.find((r: any) => r.title === 'Visited Example Park')).toMatchObject({ occurred_at: '2019-01-05T15:00:00Z' });
    for (const r of maps) expect(r.occurred_at).toBeTruthy();

    const gemini = runTomlQueries('gemini', sources);
    expect(gemini).toHaveLength(1);
    expect(gemini[0]).toMatchObject({ title: 'how do I bind a zine', occurred_at: '2024-03-01T10:00:00Z' });
    expect(gemini[0].content).toContain('saddle stitch');

    const activity = runTomlQueries('google-activity', sources);
    expect(activity.map((r: any) => r.title)).toEqual(['Searched for bookstores']);

    const docs = runTomlQueries('notebooklm', sources);
    expect(docs).toHaveLength(1);
    expect(docs[0].title).toBe('Binding methods (Zine research)');
    expect(docs[0].content).toContain('perfect bound');

    const keep = runTomlQueries('google-keep', sources);
    expect(keep).toHaveLength(1);
    expect(keep[0]).toMatchObject({ title: 'Groceries', occurred_at: '2023-11-14T22:13:20Z' });
    expect(keep[0].content).toContain('[x] bread');

    const contacts = runTomlQueries('google-contacts', sources);
    expect(contacts).toHaveLength(1);
    expect(contacts[0].content).toContain('ada@example.com');
    expect(JSON.parse(contacts[0].metadata).groups).toEqual(['Friends']);
    expect(contacts[0].occurred_at).toBeTruthy();

    const blog = runTomlQueries('blogger', sources);
    expect(blog).toHaveLength(1);
    expect(blog[0]).toMatchObject({
      title: 'First post (Example Blog)',
      content: 'Hello & welcome',
      url: 'https://example.blogspot.com/2010/01/first-post.html',
      occurred_at: '2010-01-01T12:00:00Z',
    });

    const groups = runTomlQueries('google-groups', sources);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ title: 'Meetup (Zine makers)', occurred_at: '2024-01-15T10:30:00Z' });

    const photos = runTomlQueries('googlephotos', sources);
    expect(photos).toHaveLength(1);
    expect(photos[0]).toMatchObject({ title: 'IMG_0001.jpg', occurred_at: '2021-05-03T00:00:00Z' });
    expect(photos[0].content).toContain('Print day');
    expect(JSON.parse(photos[0].metadata).albums).toEqual(['Zine launch']);
  });
});
