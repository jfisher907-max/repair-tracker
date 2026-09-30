/* Decision sheet — page script. Renders from the embedded data, restores
   saved answers from the artifact's db, and saves every tap and note.
   Answers live in collection "answers", one document per item id:
   {id, answer, note, at}. answer is null when only a note was written. */
(function () {
  'use strict'

  var DATA = JSON.parse(document.getElementById('sheet-data').textContent)
  var FILTERS = [
    { key: 'unanswered', label: 'Unanswered' },
    { key: 'all', label: 'All' },
    { key: 'stop', label: 'Do today' },
    { key: 'chain', label: 'Unblocks a chain' },
    { key: 'fact', label: 'Needs a fact only you hold' },
    { key: 'answered', label: 'Answered' },
  ]
  var TAG_WORDS = { stop: 'Do today', chain: 'Unblocks other work', fact: 'Needs a fact only you hold' }
  var SEV_WORDS = { stop: 'Do today', hold: 'Holding work' }
  var PROBLEM = "Answers aren't saving on this view — tell me in chat."

  var ITEMS = []
  var byId = {}
  DATA.groups.forEach(function (g) {
    g.items.forEach(function (it) {
      it.groupId = g.id
      ITEMS.push(it)
      byId[it.id] = it
    })
  })

  var answers = {}      // id -> {answer, note, at}
  var history = {}      // id -> {answer, note, at}: a "Let's talk" saved before the item was reopened
  var dirty = {}        // ids edited on this view before the saved answers loaded
  var queues = {}       // id -> promise chain: one write at a time per document
  var noteTimers = {}
  var statusTimers = {}
  var filter = 'unanswered'
  var cards = {}        // id -> card element
  var groupEls = []     // {el, ids}

  var dbPromise = (function () {
    try {
      if (!window.claude || typeof window.claude.use !== 'function') return Promise.resolve(null)
      return Promise.resolve(window.claude.use('db')).catch(function () { return null })
    } catch {
      return Promise.resolve(null)
    }
  })()

  // ---------- helpers ----------
  function el(tag, props, kids) {
    var n = document.createElement(tag)
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k]
        if (v == null || v === false) return
        if (k === 'text') n.textContent = v
        else if (k === 'className') n.className = v
        else if (k === 'on') Object.keys(v).forEach(function (ev) { n.addEventListener(ev, v[ev]) })
        else n.setAttribute(k, v === true ? '' : String(v))
      })
    }
    ;(kids || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c) })
    return n
  }
  function list(items) {
    return el('ul', null, items.map(function (t) { return el('li', { text: t }) }))
  }
  function isAnswered(id) {
    var a = answers[id]
    return !!a && (a.answer != null || String(a.note || '').trim() !== '')
  }
  function isCurrent(it) { return it.edition === DATA.edition && !it.sup && !it.answeredOn }
  function matches(it) {
    var f = it.f || []
    switch (filter) {
      case 'all': return true
      case 'unanswered': return !it.sup && !it.answeredOn && !isAnswered(it.id)
      case 'stop': return it.sev === 'stop' || f.indexOf('stop') >= 0
      case 'chain': return f.indexOf('chain') >= 0
      case 'fact': return f.indexOf('fact') >= 0
      case 'answered': return isAnswered(it.id) || !!it.answeredOn
    }
    return true
  }

  // ---------- render ----------
  function renderHead(root) {
    var progress = el('div', { className: 'progress' }, [
      el('div', { className: 'progress-line', id: 'progress-line', 'aria-live': 'polite' }),
      el('div', { className: 'progress-bar', 'aria-hidden': 'true' }, [el('i', { id: 'progress-fill' })]),
    ])
    root.appendChild(el('header', { className: 'head' }, [
      el('div', null, [
        el('div', { className: 'eyebrow', text: 'Wings N Things' }),
        el('h1', { text: 'Decision sheet' }),
        el('p', { className: 'sub', text: 'Edition ' + DATA.edition + ' · ' + DATA.editionLabel + '. Tap an answer or write a note; each one saves as you go.' }),
      ]),
      el('p', { className: 'alert', id: 'save-problem', role: 'alert', hidden: true, text: PROBLEM }),
      el('p', { className: 'loading-note', id: 'loading-note', text: 'Loading your saved answers…' }),
      progress,
    ]))
  }

  function renderBanner(root) {
    var b = DATA.banner
    var kids = [el('h2', { text: b.heading }), el('p', { text: b.lead })]
    ;(b.links || []).forEach(function (l) {
      kids.push(el('p', null, [el('a', { href: l.href, target: '_blank', rel: 'noopener', text: l.text })]))
    })
    b.sections.forEach(function (s) {
      if (!s.items || !s.items.length) return
      kids.push(s.collapsed
        ? el('details', { className: 'sub-list' }, [el('summary', { text: s.title + ' (' + s.items.length + ')' }), list(s.items)])
        : el('div', null, [el('h3', { text: s.title }), list(s.items)]))
    })
    root.appendChild(el('section', { className: 'banner', 'aria-label': 'What changed' }, kids))

    var la = DATA.lastAnswers
    function part(title, items) {
      return el('div', null, [
        el('h3', { text: title }),
        items && items.length ? list(items) : el('p', { className: 'empty', text: 'Nothing here.' }),
      ])
    }
    root.appendChild(el('details', { className: 'went' }, [
      el('summary', { text: 'Where your last answers went' }),
      el('div', { className: 'body' }, [
        la.intro ? el('p', { className: 'empty', text: la.intro }) : null,
        part('Done and checked', la.done),
        part('Approved, not done yet', la.approved),
        part('With us', la.withUs),
        la.withYou ? part('Waiting on you', la.withYou) : null,
      ]),
    ]))
  }

  function renderFilters(root) {
    var bar = el('div', { className: 'filter-bar' }, [
      el('div', { className: 'filters', role: 'group', 'aria-label': 'Show' },
        FILTERS.map(function (f) {
          return el('button', {
            type: 'button',
            className: 'chip',
            id: 'chip-' + f.key,
            'data-filter': f.key,
            'aria-pressed': f.key === filter ? 'true' : 'false',
            on: { click: function () { filter = f.key; paintChips(); applyFilter() } },
          }, [f.label, el('span', { className: 'n', 'data-count': f.key })])
        })),
    ])
    root.appendChild(bar)
  }

  function renderCard(it) {
    var top = el('div', { className: 'card-top' }, [
      el('span', { className: 'id', text: it.id }),
      it.sev ? el('span', { className: 'pill sev-' + it.sev, text: SEV_WORDS[it.sev] }) : null,
    ].concat((it.f || []).filter(function (t) { return t !== 'stop' }).map(function (t) {
      return el('span', { className: 'pill', text: TAG_WORDS[t] })
    })).concat([
      el('span', { className: 'pill done', 'data-done': it.id, hidden: true, text: 'Answered' }),
      el('span', { className: 'lane', text: it.lane }),
    ]))

    var rec
    if (it.none) {
      rec = el('div', { className: 'rec none' }, [
        el('div', { className: 'rec-label', text: 'No recommendation' }),
        el('p', { text: 'This needs a fact only you have.' }),
      ])
    } else {
      var pct = Math.round((it.conf || 0) * 100)
      rec = el('div', { className: 'rec' }, [
        el('div', { className: 'rec-label', text: 'My recommendation' }),
        el('p', { text: it.rec }),
        el('div', { className: 'conf' }, [
          el('span', { className: 'bar', 'aria-hidden': 'true' }, [el('i', { style: 'width:' + pct + '%' })]),
          el('span', { text: 'Confidence ' + pct + '%' }),
        ]),
      ])
    }

    var opts = el('div', { className: 'opts', role: 'group', 'aria-label': 'Your answer' },
      it.opts.map(function (o, i) {
        var mine = !it.none && it.recOpt === i
        return el('button', {
          type: 'button',
          className: 'opt',
          'data-opt': o,
          'aria-pressed': 'false',
          disabled: !!it.sup,
          on: { click: function () { toggle(it.id, o) } },
        }, [o, mine ? el('span', { className: 'mine', text: 'My pick' }) : null])
      }))

    var noteId = 'note-' + it.id
    var note = el('textarea', {
      className: 'note',
      id: noteId,
      rows: 2,
      placeholder: 'Anything to add? It saves as you type.',
      disabled: !!it.sup,
      on: { input: function (e) { onNote(it.id, e.target.value) } },
    })

    var card = el('article', {
      className: 'card' + (it.sev === 'stop' ? ' is-stop' : ''),
      id: 'item-' + it.id,
      'data-id': it.id,
    }, [
      top,
      el('h3', { className: 'q', text: it.q }),
      it.sup ? el('p', { className: 'sup-note', text: 'Replaced by ' + it.sup + '.' }) : null,
      el('p', { className: 'blocks', text: it.blocks }),
      it.reopened ? el('p', { className: 'history', 'data-history': it.id, hidden: true }) : null,
      rec,
      opts,
      el('label', { className: 'note-label', for: noteId, text: 'Note' }),
      note,
      el('div', { className: 'status', 'data-status': it.id, 'aria-live': 'polite' }),
    ])
    cards[it.id] = card
    return card
  }

  function renderGroups(root) {
    var current = []
    var past = []
    DATA.groups.forEach(function (g) {
      var fresh = g.items.filter(function (it) { return !it.answeredOn })
      var old = g.items.filter(function (it) { return !!it.answeredOn })
      if (fresh.length) current.push({ g: g, items: fresh, title: g.title })
      // Items answered in an earlier edition sit below the new ones, grouped by
      // the date they were answered.
      var byDate = {}
      old.forEach(function (it) { (byDate[it.answeredOn] = byDate[it.answeredOn] || []).push(it) })
      Object.keys(byDate).sort().reverse().forEach(function (d) {
        past.push({ g: g, items: byDate[d], title: 'Answered ' + d + ' · ' + g.title })
      })
    })
    current.concat(past).forEach(function (grp) {
      var sec = el('section', { className: 'group', 'data-group': grp.g.id }, [
        el('div', { className: 'group-head' }, [
          el('h2', { text: grp.title }),
          grp.g.note ? el('p', { text: grp.g.note }) : null,
        ]),
      ].concat(grp.items.map(renderCard)))
      groupEls.push({ el: sec, ids: grp.items.map(function (it) { return it.id }) })
      root.appendChild(sec)
    })
    root.appendChild(el('p', { className: 'empty-all', id: 'empty-all', hidden: true }))
  }

  // ---------- state painting ----------
  function paintCard(id) {
    var card = cards[id]
    if (!card) return
    var a = answers[id] || { answer: null, note: '' }
    Array.prototype.forEach.call(card.querySelectorAll('.opt'), function (b) {
      b.setAttribute('aria-pressed', a.answer != null && b.getAttribute('data-opt') === a.answer ? 'true' : 'false')
    })
    var note = card.querySelector('.note')
    if (note && document.activeElement !== note && note.value !== (a.note || '')) note.value = a.note || ''
    var done = isAnswered(id)
    card.classList.toggle('is-answered', done)
    var pill = card.querySelector('[data-done]')
    if (pill) {
      pill.hidden = !done
      pill.textContent = a.answer != null ? 'Answered' : 'Note saved'
    }
  }
  function paintChips() {
    FILTERS.forEach(function (f) {
      var c = document.getElementById('chip-' + f.key)
      if (c) c.setAttribute('aria-pressed', f.key === filter ? 'true' : 'false')
    })
  }
  function updateCounts() {
    FILTERS.forEach(function (f) {
      var saved = filter
      filter = f.key
      var n = ITEMS.filter(matches).length
      filter = saved
      var span = document.querySelector('[data-count="' + f.key + '"]')
      if (span) span.textContent = String(n)
    })
    var mine = ITEMS.filter(isCurrent)
    var done = mine.filter(function (it) { return isAnswered(it.id) }).length
    var line = document.getElementById('progress-line')
    // An edition with no new questions has nothing to count: say so, and
    // how many earlier ones are still open, instead of "0 of 0".
    var open = ITEMS.filter(function (it) { return !it.sup && !it.answeredOn && !isAnswered(it.id) }).length
    if (line) line.textContent = mine.length
      ? done + ' of ' + mine.length + ' answered'
      : 'No new questions this edition · ' + open + ' still open from earlier'
    var fill = document.getElementById('progress-fill')
    if (fill) fill.style.width = (mine.length ? Math.round((done / mine.length) * 100) : 0) + '%'
    if (fill && fill.parentNode) fill.parentNode.hidden = !mine.length
  }
  // The filter is applied when it changes and when the saved answers load —
  // never on a tap, so a card doesn't vanish from under a finger.
  function applyFilter() {
    var shown = 0
    ITEMS.forEach(function (it) {
      var vis = matches(it)
      cards[it.id].hidden = !vis
      if (vis) shown++
    })
    groupEls.forEach(function (g) {
      g.el.hidden = !g.ids.some(function (id) { return !cards[id].hidden })
    })
    var empty = document.getElementById('empty-all')
    if (empty) {
      empty.hidden = shown > 0
      empty.textContent = filter === 'unanswered'
        ? 'Nothing left unanswered. Thank you — I will pick these up.'
        : 'Nothing in this view.'
    }
  }

  // ---------- saving ----------
  function setStatus(id, kind) {
    var s = document.querySelector('[data-status="' + id + '"]')
    if (!s) return
    clearTimeout(statusTimers[id])
    s.className = 'status' + (kind === 'saved' ? ' saved' : kind === 'failed' ? ' failed' : '')
    s.textContent = kind === 'saving' ? 'Saving…' : kind === 'saved' ? 'Saved' : kind === 'failed' ? 'Not saved' : kind === 'typing' ? 'Typing…' : ''
    if (kind === 'saved') statusTimers[id] = setTimeout(function () { s.textContent = ''; s.className = 'status' }, 2500)
  }
  function showProblem() {
    var p = document.getElementById('save-problem')
    if (p) p.hidden = false
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms) }) }

  function save(id) {
    setStatus(id, 'saving')
    var run = function () {
      return dbPromise.then(function (db) {
        if (!db) { var e = new Error('db unavailable'); e.code = 'no_db'; throw e }
        var a = answers[id] || { answer: null, note: '' }
        var body = { id: id, answer: a.answer == null ? null : a.answer, note: a.note || '', at: new Date().toISOString() }
        var ref = db.collection('answers').doc(id)
        return ref.set(body).catch(function (err) {
          if (err && err.code === 'unavailable') {
            return wait(400 + Math.floor(Math.random() * 500)).then(function () { return ref.set(body) })
          }
          throw err
        })
      })
    }
    var p = (queues[id] || Promise.resolve()).then(run)
    queues[id] = p.catch(function () {})
    return p.then(
      function () { setStatus(id, 'saved') },
      function (err) {
        setStatus(id, 'failed')
        showProblem()
        if (window.console) console.warn('decision sheet: save failed for ' + id, err && err.code)
      })
  }
  function toggle(id, opt) {
    var a = answers[id] || { answer: null, note: '' }
    a.answer = a.answer === opt ? null : opt
    answers[id] = a
    dirty[id] = true
    clearTimeout(noteTimers[id])
    paintCard(id)
    updateCounts()
    save(id)
  }
  function onNote(id, value) {
    var a = answers[id] || { answer: null, note: '' }
    a.note = value
    answers[id] = a
    dirty[id] = true
    setStatus(id, 'typing')
    clearTimeout(noteTimers[id])
    noteTimers[id] = setTimeout(function () {
      paintCard(id)
      updateCounts()
      save(id)
    }, 700)
  }

  // ---------- boot ----------
  var root = document.getElementById('sheet')
  renderHead(root)
  renderBanner(root)
  renderFilters(root)
  renderGroups(root)
  ITEMS.forEach(function (it) { paintCard(it.id) })
  updateCounts()
  applyFilter()

  dbPromise.then(function (db) {
    var loading = document.getElementById('loading-note')
    if (!db) {
      if (loading) loading.hidden = true
      showProblem()
      return
    }
    return db.collection('answers').get().then(function (snap) {
      snap.docs.forEach(function (d) {
        if (!d.exists || dirty[d.id] || !byId[d.id]) return
        var v = d.data() || {}
        // Reopened after a "Let's talk": what was saved before the reopening is
        // shown as history, and the item counts as open again. A new answer
        // replaces it (the old one is kept in docs/DECISIONS.md).
        var reopened = byId[d.id].reopened
        if (reopened && String(v.at || '') < reopened) {
          history[d.id] = { answer: typeof v.answer === 'string' ? v.answer : null, note: typeof v.note === 'string' ? v.note : '', at: v.at || '' }
          var h = document.querySelector('[data-history="' + d.id + '"]')
          if (h) {
            var said = history[d.id].answer || ''
            if (history[d.id].note) said += (said ? ': ' : '') + '“' + history[d.id].note + '”'
            h.textContent = 'You said earlier — ' + said
            h.hidden = !said
          }
          return
        }
        answers[d.id] = {
          answer: typeof v.answer === 'string' ? v.answer : null,
          note: typeof v.note === 'string' ? v.note : '',
          at: v.at || null,
        }
      })
      ITEMS.forEach(function (it) { paintCard(it.id) })
      updateCounts()
      applyFilter()
      if (loading) loading.hidden = true
      document.documentElement.setAttribute('data-answers', 'loaded')
    }, function (err) {
      if (loading) loading.hidden = true
      showProblem()
      if (window.console) console.warn('decision sheet: could not read saved answers', err && err.code)
    })
  })
})()
