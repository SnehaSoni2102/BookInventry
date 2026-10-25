// Stands in for Open Library and Google Books during e2e runs (recorded fixtures only).
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

const fx = (n) => readFileSync(new URL(`../../api/test/fixtures/${n}`, import.meta.url), 'utf8');
const ISBN = '9780143127550';
const send = (res, body, status = 200) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};

createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const isbn = /ISBN:(\d+)|isbn:(\d+)/i.exec(decodeURIComponent(url.search))?.slice(1).find(Boolean);
  if (url.pathname === '/ol/api/books') return send(res, isbn === ISBN ? fx('ol-books-9780143127550.json') : {});
  if (url.pathname.startsWith('/ol/isbn/')) return send(res, url.pathname.includes(ISBN) ? fx('ol-isbn-9780143127550.json') : {}, url.pathname.includes(ISBN) ? 200 : 404);
  if (url.pathname.startsWith('/ol/works/')) return send(res, fx('ol-work-OL17295077W.json'));
  if (url.pathname === '/ol/search.json') return send(res, fx('ol-search-god-of-small-things.json'));
  if (url.pathname === '/gb') return send(res, isbn === ISBN ? fx('gb-isbn-9780143127550.json') : fx('gb-empty.json'));
  send(res, {}, 404);
}).listen(4010, '127.0.0.1', () => console.log('mock providers on :4010'));
