// Builds vancouver/trip.ics from the plan data at the top of index.html.
// Run after any change to DAYS:  node vancouver/_build/make_ics.js
// Booking references and flight confirmation codes are not in the page data, so none reach the file.
var fs = require('fs'), path = require('path');
var dir = path.join(__dirname, '..');
var html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
var a = html.indexOf('var HOME='), b = html.indexOf('/* ---------- data: checklists ---------- */');
if (a < 0 || b < 0) throw new Error('data block not found');
var data = new Function(html.slice(a, b) + ';return {DAYS:DAYS,TRIP:TRIP,HOME:HOME};')();

function pad(n) { return (n < 10 ? '0' : '') + n; }
// Early December in Vancouver and San Francisco is UTC-8.
function utc(date, min) {
  var d = new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), 0, min + 480));
  return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + 'T' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + '00Z';
}
function clock(s) { // "2:47 PM" -> minutes
  var m = /(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(s); if (!m) return null;
  var h = +m[1] % 12 + (/pm/i.test(m[3]) ? 12 : 0); return h * 60 + +m[2];
}
function txt(s) { return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }
function fold(line) { // 75-octet folding
  var out = [], buf = Buffer.from(line, 'utf8');
  if (buf.length <= 75) return line;
  var cur = '', len = 0;
  Array.from(line).forEach(function (ch) {
    var n = Buffer.byteLength(ch, 'utf8');
    if (len + n > (out.length ? 74 : 75)) { out.push(cur); cur = ''; len = 0; }
    cur += ch; len += n;
  });
  if (cur) out.push(cur);
  return out.join('\r\n ');
}

var L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//popcornlove//vancouver-trip//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Vancouver Christmas Market Trip'];
var n = 0;
// Stops whose listed time is an arrival window, not the length of the visit (minutes).
var LONG = { '2:930': 120 };
data.DAYS.forEach(function (day, di) {
  var its = day.items.filter(function (it) { return /\d/.test(it.tm); });
  its.forEach(function (it, k) {
    var start = it.m, end = null;
    var range = /(\d{1,2}:\d{2})\s*[–-]\s*(\d{1,2}:\d{2}\s*[AP]M)/i.exec(it.tm);
    if (range) end = clock(range[2]);
    if (/^Flight /.test(it.tt)) { var arr = /→\s*[A-Z]{3}\s+(\d{1,2}:\d{2}\s*[AP]M)/.exec(it.sb); if (arr) end = clock(arr[1]); }
    if (end === null) { var nx = its[k + 1]; end = nx ? Math.min(nx.m, start + 120) : start + 90; }
    if (LONG[di + ':' + it.m]) end = start + LONG[di + ':' + it.m];
    if (end < start + 15) end = start + 15;
    var loc = it.home ? data.HOME.n + ', ' + data.HOME.a : (it.map && it.map.a ? it.map.n + ', ' + it.map.a : '');
    var desc = it.sb + (it.li ? '\n• ' + it.li.join('\n• ') : '') + '\n\nhttps://popcornlove.net/vancouver/';
    L.push('BEGIN:VEVENT', 'UID:van26-d' + di + '-' + it.m + '@popcornlove.net', 'DTSTAMP:20261128T000000Z',
      'DTSTART:' + utc(data.TRIP[di], start), 'DTEND:' + utc(data.TRIP[di], end),
      'SUMMARY:' + txt(it.tt.replace(/ — /g, ' - ')), 'DESCRIPTION:' + txt(desc));
    if (loc) L.push('LOCATION:' + txt(loc));
    L.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + txt(it.tt), 'TRIGGER:-PT20M', 'END:VALARM', 'END:VEVENT');
    n++;
  });
});
L.push('END:VCALENDAR');
fs.writeFileSync(path.join(dir, 'trip.ics'), L.map(fold).join('\r\n') + '\r\n');
console.log('trip.ics: ' + n + ' events');
