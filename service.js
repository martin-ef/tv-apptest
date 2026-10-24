/* Testdienst fuer TizenBrew (ES5, damit er auch auf altem Node laeuft).
 * Prueft im 2-Sekunden-Takt, ob der Fernseher verraet, welche App laeuft,
 * und schreibt jede Aenderung in ein Protokoll.
 * Abruf: http://<TV-IP>:8095/log   Testweise TizenBrew nach vorn holen: /launch
 */
var http = require('http');
var https = require('https');
var urlmod = require('url');

var NETFLIX = '3201907018807';
var PORT = 8095;
var log = [];
var last = {};

function add(msg) {
  var t = new Date().toISOString().substr(11, 8);
  log.push(t + '  ' + msg);
  if (log.length > 400) log.shift();
}
function changed(key, val) {
  if (last[key] === val) return false;
  last[key] = val;
  return true;
}

add('Dienst gestartet');

/* Weg 1 und 2: REST-Schnittstelle des Fernsehers, von innen abgefragt */
function probe(label, lib, address) {
  try {
    var opts = urlmod.parse(address);
    opts.rejectUnauthorized = false;
    var req = lib.get(opts, function (res) {
      var body = '';
      res.on('data', function (d) { body += d; });
      res.on('end', function () {
        var v = res.statusCode + ' ' + body.replace(/\s+/g, ' ').substr(0, 160);
        if (changed(label, v)) add(label + ': ' + v);
      });
    });
    req.on('error', function (e) { if (changed(label, 'ERR ' + e.message)) add(label + ': Fehler ' + e.message); });
    req.setTimeout(3000, function () { req.abort(); });
  } catch (e) {
    if (changed(label, 'EXC ' + e.message)) add(label + ': Ausnahme ' + e.message);
  }
}

/* Weg 3: Liste der laufenden Apps ueber die Tizen-Schnittstelle */
function contexts() {
  try {
    tizen.application.getAppsContext(function (list) {
      var ids = list.map(function (c) { return c.appId; }).sort().join(', ');
      if (changed('ctx', ids)) add('Laufende Apps: ' + ids);
    }, function (e) {
      if (changed('ctx', 'ERR ' + e.name)) add('Laufende Apps: Fehler ' + e.name + ' ' + e.message);
    });
  } catch (e) {
    if (changed('ctx', 'EXC ' + e.name)) add('Laufende Apps: Ausnahme ' + e.name + ' ' + e.message);
  }
}

/* Weg 4: Benachrichtigung, wenn eine App nach vorn kommt oder verschwindet */
try {
  tizen.application.addAppStatusChangeListener(function (appId, isActive) {
    add('WECHSEL ' + appId + ' -> ' + (isActive ? 'im Vordergrund' : 'weg'));
  });
  add('Wechsel-Meldungen angemeldet');
} catch (e) {
  add('Wechsel-Meldungen: Ausnahme ' + e.name + ' ' + e.message);
}

setInterval(function () {
  probe('REST 8001', http, 'http://127.0.0.1:8001/api/v2/applications/' + NETFLIX);
  probe('REST 8002', https, 'https://127.0.0.1:8002/api/v2/applications/' + NETFLIX);
  contexts();
}, 2000);

/* Kleiner Webserver: Protokoll lesen, TizenBrew testweise nach vorn holen */
http.createServer(function (req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  if (req.url.indexOf('/launch') === 0) {
    try {
      var pkg = tizen.application.getAppInfo().packageId;
      var target = pkg + '.TizenBrewStandalone';
      add('Starte ' + target + ' ...');
      tizen.application.launch(target, function () { add('Start ok'); }, function (e) { add('Start Fehler ' + e.name + ' ' + e.message); });
      res.end('Startversuch ausgeloest\n');
    } catch (e) {
      add('Start Ausnahme ' + e.name + ' ' + e.message);
      res.end('Ausnahme: ' + e.message + '\n');
    }
    return;
  }
  res.end(log.join('\n') + '\n');
}).listen(PORT, '0.0.0.0', function () { add('Webserver auf Port ' + PORT); });
