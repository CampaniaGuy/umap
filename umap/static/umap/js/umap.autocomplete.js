U.AutoComplete = L.Class.extend({
  options: {
    placeholder: 'Start typing...',
    emptyMessage: 'No result',
    allowFree: true,
    minChar: 2,
    maxResults: 5,
  },

  CACHE: '',
  RESULTS: [],

  initialize: function (el, options) {
    this.el = el
    const ui = new U.UI(document.querySelector('header'))
    this.server = new U.ServerRequest(ui)
    L.setOptions(this, options)
    let CURRENT = null
    try {
      Object.defineProperty(this, 'CURRENT', {
        get: function () {
          return CURRENT
        },
        set: function (index) {
          if (typeof index === 'object') {
            index = this.resultToIndex(index)
          }
          CURRENT = index
        },
      })
    } catch (e) {
      // Hello IE8
    }
    return this
  },

  createInput: function () {
    this.input = L.DomUtil.element({
      tagName: 'input',
      type: 'text',
      parent: this.el,
      placeholder: this.options.placeholder,
      autocomplete: 'off',
      className: this.options.className,
    })
    L.DomEvent.on(this.input, 'keydown', this.onKeyDown, this)
    L.DomEvent.on(this.input, 'keyup', this.onKeyUp, this)
    L.DomEvent.on(this.input, 'blur', this.onBlur, this)
  },

  createContainer: function () {
    this.container = L.DomUtil.element({
      tagName: 'ul',
      parent: document.body,
      className: 'umap-autocomplete',
    })
  },

  resizeContainer: function () {
    const l = this.getLeft(this.input)
    const t = this.getTop(this.input) + this.input.offsetHeight
    this.container.style.left = `${l}px`
    this.container.style.top = `${t}px`
    const width = this.options.width ? this.options.width : this.input.offsetWidth - 2
    this.container.style.width = `${width}px`
  },

  onKeyDown: function (e) {
    switch (e.keyCode) {
      case U.Keys.TAB:
        if (this.CURRENT !== null) this.setChoice()
        L.DomEvent.stop(e)
        break
      case U.Keys.ENTER:
        L.DomEvent.stop(e)
        this.setChoice()
        break
      case U.Keys.ESC:
        L.DomEvent.stop(e)
        this.hide()
        break
      case U.Keys.DOWN:
        if (this.RESULTS.length > 0) {
          if (this.CURRENT !== null && this.CURRENT < this.RESULTS.length - 1) {
            // what if one result?
            this.CURRENT++
            this.highlight()
          } else if (this.CURRENT === null) {
            this.CURRENT = 0
            this.highlight()
          }
        }
        break
      case U.Keys.UP:
        if (this.CURRENT !== null) {
          L.DomEvent.stop(e)
        }
        if (this.RESULTS.length > 0) {
          if (this.CURRENT > 0) {
            this.CURRENT--
            this.highlight()
          } else if (this.CURRENT === 0) {
            this.CURRENT = null
            this.highlight()
          }
        }
        break
    }
  },

  onKeyUp: function (e) {
    const special = [
      U.Keys.TAB,
      U.Keys.ENTER,
      U.Keys.LEFT,
      U.Keys.RIGHT,
      U.Keys.DOWN,
      U.Keys.UP,
      U.Keys.APPLE,
      U.Keys.SHIFT,
      U.Keys.ALT,
      U.Keys.CTRL,
    ]
    if (special.indexOf(e.keyCode) === -1) {
      this.search()
    }
  },

  onBlur: function () {
    setTimeout(() => this.hide(), 100)
  },

  clear: function () {
    this.RESULTS = []
    this.CURRENT = null
    this.CACHE = ''
    this.container.innerHTML = ''
  },

  hide: function () {
    this.clear()
    this.container.style.display = 'none'
    this.input.value = ''
  },

  setChoice: function (choice) {
    choice = choice || this.RESULTS[this.CURRENT]
    if (choice) {
      this.input.value = choice.item.label
      this.options.on_select(choice)
      this.displaySelected(choice)
      this.hide()
      if (this.options.callback) {
        L.Util.bind(this.options.callback, this)(choice)
      }
    }
  },

  search: async function () {
    let val = this.input.value
    if (val.length < this.options.minChar) {
      this.clear()
      return
    }
    if (`${val}` === `${this.CACHE}`) return
    else this.CACHE = val
    val = val.toLowerCase()
    const [{ data }, response] = await this.server.get(
      `/agnocomplete/AutocompleteUser/?q=${encodeURIComponent(val)}`
    )
    this.handleResults(data)
  },

  createResult: function (item) {
    const el = L.DomUtil.element({
      tagName: 'li',
      parent: this.container,
      textContent: item.label,
    })
    const result = {
      item: item,
      el: el,
    }
    L.DomEvent.on(
      el,
      'mouseover',
      function () {
        this.CURRENT = result
        this.highlight()
      },
      this
    )
    L.DomEvent.on(
      el,
      'mousedown',
      function () {
        this.setChoice()
      },
      this
    )
    return result
  },

  resultToIndex: function (result) {
    let out = null
    this.forEach(this.RESULTS, (item, index) => {
      if (item.item.value == result.item.value) {
        out = index
        return
      }
    })
    return out
  },

  handleResults: function (data) {
    this.clear()
    this.container.style.display = 'block'
    this.resizeContainer()
    this.forEach(data, (item) => {
      this.RESULTS.push(this.createResult(item))
    })
    this.CURRENT = 0
    this.highlight()
    //TODO manage no results
  },

  highlight: function () {
    this.forEach(this.RESULTS, (result, index) => {
      if (index === this.CURRENT) L.DomUtil.addClass(result.el, 'on')
      else L.DomUtil.removeClass(result.el, 'on')
    })
  },

  getLeft: function (el) {
    let tmp = el.offsetLeft
    el = el.offsetParent
    while (el) {
      tmp += el.offsetLeft
      el = el.offsetParent
    }
    return tmp
  },

  getTop: function (el) {
    let tmp = el.offsetTop
    el = el.offsetParent
    while (el) {
      tmp += el.offsetTop
      el = el.offsetParent
    }
    return tmp
  },

  forEach: function (els, callback) {
    Array.prototype.forEach.call(els, callback)
  },
})

U.AutoComplete.Ajax = U.AutoComplete.extend({
  initialize: function (el, options) {
    U.AutoComplete.prototype.initialize.call(this, el, options)
    if (!this.el) return this
    this.createInput()
    this.createContainer()
    this.selected_container = this.initSelectedContainer()
  },

  optionToResult: function (option) {
    return {
      value: option.value,
      label: option.innerHTML,
    }
  },
})

U.AutoComplete.Ajax.SelectMultiple = U.AutoComplete.Ajax.extend({
  initSelectedContainer: function () {
    return L.DomUtil.after(
      this.input,
      L.DomUtil.element({ tagName: 'ul', className: 'umap-multiresult' })
    )
  },

  displaySelected: function (result) {
    const result_el = L.DomUtil.element({
      tagName: 'li',
      parent: this.selected_container,
    })
    result_el.textContent = result.item.label
    const close = L.DomUtil.element({
      tagName: 'span',
      parent: result_el,
      className: 'close',
      textContent: '×',
    })
    L.DomEvent.on(
      close,
      'click',
      function () {
        this.selected_container.removeChild(result_el)
        this.options.on_unselect(result)
      },
      this
    )
    this.hide()
  },
})

U.AutoComplete.Ajax.Select = U.AutoComplete.Ajax.extend({
  initSelectedContainer: function () {
    return L.DomUtil.after(
      this.input,
      L.DomUtil.element({ tagName: 'div', className: 'umap-singleresult' })
    )
  },

  displaySelected: function (result) {
    const result_el = L.DomUtil.element({
      tagName: 'div',
      parent: this.selected_container,
    })
    result_el.textContent = result.item.label
    const close = L.DomUtil.element({
      tagName: 'span',
      parent: result_el,
      className: 'close',
      textContent: '×',
    })
    this.input.style.display = 'none'
    L.DomEvent.on(
      close,
      'click',
      function () {
        this.selected_container.innerHTML = ''
        this.input.style.display = 'block'
      },
      this
    )
    this.hide()
  },
})
