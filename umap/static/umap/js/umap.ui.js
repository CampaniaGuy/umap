/*
 * Modals
 */
L.U.UI = L.Evented.extend({
  ALERTS: Array(),
  ALERT_ID: null,
  TOOLTIP_ID: null,

  initialize(parent) {
    this.parent = parent
    this.container = L.DomUtil.create('div', 'leaflet-ui-container', this.parent)
    L.DomEvent.disableClickPropagation(this.container)
    L.DomEvent.on(this.container, 'contextmenu', L.DomEvent.stopPropagation) // Do not activate our custom context menu.
    L.DomEvent.on(this.container, 'mousewheel', L.DomEvent.stopPropagation)
    L.DomEvent.on(this.container, 'MozMousePixelScroll', L.DomEvent.stopPropagation)
    this._panel = L.DomUtil.create('div', '', this.container)
    this._panel.id = 'umap-ui-container'
    this._alert = L.DomUtil.create('div', 'with-transition', this.container)
    this._alert.id = 'umap-alert-container'
    this._tooltip = L.DomUtil.create('div', '', this.container)
    this._tooltip.id = 'umap-tooltip-container'
  },

  resetPanelClassName() {
    this._panel.className = 'with-transition'
  },

  openPanel({ data, actions, className }) {
    this.fire('panel:open')
    // We reset all because we can't know which class has been added
    // by previous ui processes...
    this.resetPanelClassName()
    this._panel.innerHTML = ''
    const actionsContainer = L.DomUtil.create('ul', 'toolbox', this._panel)
    const body = L.DomUtil.create('div', 'body', this._panel)
    if (data.html.nodeType && data.html.nodeType === 1) body.appendChild(data.html)
    else body.innerHTML = data.html
    const closeLink = L.DomUtil.create('li', 'umap-close-link', actionsContainer)
    L.DomUtil.add('i', 'umap-close-icon', closeLink)
    const label = L.DomUtil.create('span', '', closeLink)
    label.title = label.textContent = L._('Close')
    if (actions) {
      for (let i = 0; i < actions.length; i++) {
        actionsContainer.appendChild(actions[i])
      }
    }
    if (className) L.DomUtil.addClass(this._panel, className)
    if (L.DomUtil.hasClass(this.parent, 'umap-ui')) {
      // Already open.
      this.fire('panel:ready')
    } else {
      L.DomEvent.once(
        this._panel,
        'transitionend',
        function (e) {
          this.fire('panel:ready')
        },
        this
      )
      L.DomUtil.addClass(this.parent, 'umap-ui')
    }
    L.DomEvent.on(closeLink, 'click', this.closePanel, this)
  },

  closePanel() {
    this.resetPanelClassName()
    L.DomUtil.removeClass(this.parent, 'umap-ui')
    this.fire('panel:closed')
  },

  alert(e) {
    if (L.DomUtil.hasClass(this.parent, 'umap-alert')) this.ALERTS.push(e)
    else this.popAlert(e)
  },

  popAlert(e) {
    const self = this
    if (!e) {
      if (this.ALERTS.length) e = this.ALERTS.pop()
      else return
    }
    let timeoutID
    const level_class = e.level && e.level == 'info' ? 'info' : 'error'
    this._alert.innerHTML = ''
    L.DomUtil.addClass(this.parent, 'umap-alert')
    L.DomUtil.addClass(this._alert, level_class)
    const close = function () {
      if (timeoutID !== this.ALERT_ID) {
        return
      } // Another alert has been forced
      this._alert.innerHTML = ''
      L.DomUtil.removeClass(this.parent, 'umap-alert')
      L.DomUtil.removeClass(this._alert, level_class)
      if (timeoutID) window.clearTimeout(timeoutID)
      this.popAlert()
    }
    const closeLink = L.DomUtil.create('a', 'umap-close-link', this._alert)
    closeLink.href = '#'
    L.DomUtil.add('i', 'umap-close-icon', closeLink)
    const label = L.DomUtil.create('span', '', closeLink)
    label.title = label.textContent = L._('Close')
    L.DomEvent.on(closeLink, 'click', L.DomEvent.stop).on(
      closeLink,
      'click',
      close,
      this
    )
    L.DomUtil.add('div', '', this._alert, e.content)
    if (e.actions) {
      let action
      let el
      for (let i = 0; i < e.actions.length; i++) {
        action = e.actions[i]
        el = L.DomUtil.element('a', { className: 'umap-action' }, this._alert)
        el.href = '#'
        el.textContent = action.label
        L.DomEvent.on(el, 'click', L.DomEvent.stop).on(el, 'click', close, this)
        if (action.callback)
          L.DomEvent.on(
            el,
            'click',
            action.callback,
            action.callbackContext || this.map
          )
      }
    }
    self.ALERT_ID = timeoutID = window.setTimeout(
      L.bind(close, this),
      e.duration || 3000
    )
  },

  tooltip({ anchor, position, content, duration }) {
    this.TOOLTIP_ID = Math.random()
    const id = this.TOOLTIP_ID
    L.DomUtil.addClass(this.parent, 'umap-tooltip')
    if (anchor && position === 'top') this.anchorTooltipTop(anchor)
    else if (anchor && position === 'left') this.anchorTooltipLeft(anchor)
    else this.anchorTooltipAbsolute()
    this._tooltip.innerHTML = content
    function closeIt() {
      this.closeTooltip(id)
    }
    if (anchor) L.DomEvent.once(anchor, 'mouseout', closeIt, this)
    if (duration !== Infinity)
      window.setTimeout(L.bind(closeIt, this), duration || 3000)
  },

  anchorTooltipAbsolute() {
    this._tooltip.className = ''
    const left =
      this.parent.offsetLeft +
      this.parent.clientWidth / 2 -
      this._tooltip.clientWidth / 2
    const top = this.parent.offsetTop + 75
    this.setTooltipPosition({ top, left })
  },

  anchorTooltipTop(el) {
    this._tooltip.className = 'tooltip-top'
    const coords = this.getPosition(el)
    this.setTooltipPosition({
      left: coords.left - 10,
      bottom: this.getDocHeight() - coords.top + 11,
    })
  },

  anchorTooltipLeft(el) {
    this._tooltip.className = 'tooltip-left'
    const coords = this.getPosition(el)
    this.setTooltipPosition({
      top: coords.top,
      right: document.documentElement.offsetWidth - coords.left + 11,
    })
  },

  closeTooltip(id) {
    if (id && id !== this.TOOLTIP_ID) return
    this._tooltip.innerHTML = ''
    L.DomUtil.removeClass(this.parent, 'umap-tooltip')
  },

  getPosition(el) {
    return el.getBoundingClientRect()
  },

  setTooltipPosition({ left, right, top, bottom }) {
    if (left) this._tooltip.style.left = `${left}px`
    else this._tooltip.style.left = 'initial'
    if (right) this._tooltip.style.right = `${right}px`
    else this._tooltip.style.right = 'initial'
    if (top) this._tooltip.style.top = `${top}px`
    else this._tooltip.style.top = 'initial'
    if (bottom) this._tooltip.style.bottom = `${bottom}px`
    else this._tooltip.style.bottom = 'initial'
  },

  getDocHeight() {
    const D = document
    return Math.max(
      D.body.scrollHeight,
      D.documentElement.scrollHeight,
      D.body.offsetHeight,
      D.documentElement.offsetHeight,
      D.body.clientHeight,
      D.documentElement.clientHeight
    )
  },
})
