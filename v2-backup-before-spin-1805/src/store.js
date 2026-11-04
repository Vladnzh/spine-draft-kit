(function (root) {
  'use strict';
  var NAME = 'spine-draft-kit';
  var STORE = 'projects';
  var memory = {};
  var dbPromise = null;
  var persistent = true;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve) {
      var done = false;
      var finish = function (db) { if (done) return; done = true; if (!db) persistent = false; resolve(db); };
      setTimeout(function () { finish(null); }, 3000);
      try {
        var req = root.indexedDB.open(NAME, 1);
        req.onupgradeneeded = function () { req.result.createObjectStore(STORE, { keyPath: 'id' }); };
        req.onsuccess = function () { finish(req.result); };
        req.onerror = function () { finish(null); };
        req.onblocked = function () { finish(null); };
      } catch (e) { finish(null); }
    });
    return dbPromise;
  }

  function run(mode, fn) {
    return open().then(function (db) {
      if (!db) return fn(null);
      return new Promise(function (resolve, reject) {
        var t;
        try { t = db.transaction(STORE, mode); } catch (e) { persistent = false; resolve(fn(null)); return; }
        var req = fn(t.objectStore(STORE));
        t.oncomplete = function () { resolve(req && 'result' in req ? req.result : undefined); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error); };
      });
    });
  }

  root.SpineKitStore = {
    list: function () {
      return run('readonly', function (st) {
        if (!st) return { result: Object.keys(memory).map(function (k) { return memory[k]; }) };
        return st.getAll();
      }).then(function (all) { return (all || []).slice().sort(function (a, b) { return (b.updated || 0) - (a.updated || 0); }); });
    },
    get: function (id) {
      return run('readonly', function (st) { return st ? st.get(id) : { result: memory[id] }; });
    },
    put: function (rec) {
      memory[rec.id] = rec;
      return run('readwrite', function (st) { return st ? st.put(rec) : null; }).catch(function () { persistent = false; });
    },
    remove: function (id) {
      delete memory[id];
      return run('readwrite', function (st) { return st ? st.delete(id) : null; }).catch(function () { persistent = false; });
    },
    persistent: function () { return persistent; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
