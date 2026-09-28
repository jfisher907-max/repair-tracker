/* TEST BUILD ONLY — never in the published page. A stand-in for
   claude.use("db") shaped like the runtime contract (collection().get(),
   doc().set()), persisting to localStorage so a reload proves restore.
   ?nodb=1 makes use("db") resolve null; ?fail=1 makes every save reject. */
(function () {
  if (window.claude) return
  var KEY = 'decision-sheet-mockdb:answers'
  var params = new URLSearchParams(location.search)
  function load() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') } catch (e) { return {} } }
  function store(all) { localStorage.setItem(KEY, JSON.stringify(all)) }
  function delay(ms) { return new Promise(function (r) { setTimeout(r, ms) }) }
  function snap(id, body) {
    return {
      id: id,
      exists: body !== undefined,
      data: function () { return body },
      metadata: { fromCache: false, hasPendingWrites: false },
    }
  }
  var db = Object.freeze({
    collection: function (path) {
      return {
        path: path,
        doc: function (id) {
          return {
            id: id,
            path: path + '/' + id,
            set: function (body) {
              return delay(80).then(function () {
                if (params.get('fail')) throw { code: 'invalid_argument', message: 'mock refused' }
                var all = load()
                all[id] = JSON.parse(JSON.stringify(body))
                store(all)
              })
            },
            get: function () { return delay(40).then(function () { return snap(id, load()[id]) }) },
          }
        },
        get: function () {
          return delay(60).then(function () {
            var all = load()
            var docs = Object.keys(all).sort().map(function (id) { return snap(id, all[id]) })
            return { docs: docs, size: docs.length, empty: !docs.length, docChanges: function () { return [] }, metadata: { fromCache: false, hasPendingWrites: false } }
          })
        },
      }
    },
  })
  window.claude = {
    use: function (name) {
      return delay(150).then(function () { return name === 'db' && !params.get('nodb') ? db : null })
    },
  }
})()
