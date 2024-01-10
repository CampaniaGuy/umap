L.U.DataLayer = L.Evented.extend({
  options: {
    displayOnLoad: true,
    inCaption: true,
    browsable: true,
    editMode: 'advanced',
  },

  initialize: function (map, data) {
    this.map = map
    this._index = Array()
    this._layers = {}
    this._geojson = null
    this._propertiesIndex = []
    this._loaded = false // Are layer metadata loaded
    this._dataloaded = false // Are layer data loaded

    this.parentPane = this.map.getPane('overlayPane')
    this.pane = this.map.createPane(`datalayer${L.stamp(this)}`, this.parentPane)
    this.pane.dataset.id = L.stamp(this)
    this.renderer = L.svg({ pane: this.pane })

    let isDirty = false
    let isDeleted = false
    const self = this
    try {
      Object.defineProperty(this, 'isDirty', {
        get: function () {
          return isDirty
        },
        set: function (status) {
          if (!isDirty && status) self.fire('dirty')
          isDirty = status
          if (status) {
            self.map.addDirtyDatalayer(self)
            // A layer can be made dirty by indirect action (like dragging layers)
            // we need to have it loaded before saving it.
            if (!self.isLoaded()) self.fetchData()
          } else {
            self.map.removeDirtyDatalayer(self)
            self.isDeleted = false
          }
        },
      })
    } catch (e) {
      // Certainly IE8, which has a limited version of defineProperty
    }
    try {
      Object.defineProperty(this, 'isDeleted', {
        get: function () {
          return isDeleted
        },
        set: function (status) {
          if (!isDeleted && status) self.fire('deleted')
          isDeleted = status
          if (status) self.isDirty = status
        },
      })
    } catch (e) {
      // Certainly IE8, which has a limited version of defineProperty
    }
    this.setUmapId(data.id)
    this.setOptions(data)
    // Retrocompat
    if (this.options.remoteData && this.options.remoteData.from) {
      this.options.fromZoom = this.options.remoteData.from
      delete this.options.remoteData.from
    }
    if (this.options.remoteData && this.options.remoteData.to) {
      this.options.toZoom = this.options.remoteData.to
      delete this.options.remoteData.to
    }
    this.backupOptions()
    this.connectToMap()
    this.permissions = new L.U.DataLayerPermissions(this)
    if (this.showAtLoad()) this.show()
    if (!this.umap_id) this.isDirty = true

    this.onceLoaded(function () {
      this.map.on('moveend', this.onMoveEnd, this)
    })
    // Only layers that are displayed on load must be hidden/shown
    // Automatically, others will be shown manually, and thus will
    // be in the "forced visibility" mode
    if (this.autoLoaded()) this.map.on('zoomend', this.onZoomEnd, this)
  },

  onMoveEnd: function (e) {
    if (this.isRemoteLayer() && this.showAtZoom()) this.fetchRemoteData()
  },

  onZoomEnd: function (e) {
    if (this._forcedVisibility) return
    if (!this.showAtZoom() && this.isVisible()) this.hide()
    if (this.showAtZoom() && !this.isVisible()) this.show()
  },

  showAtLoad: function () {
    return this.autoLoaded() && this.showAtZoom()
  },

  autoLoaded: function () {
    return (
      (this.map.datalayersOnLoad &&
        this.umap_id &&
        this.map.datalayersOnLoad.indexOf(this.umap_id.toString()) !== -1) ||
      (!this.map.datalayersOnLoad && this.options.displayOnLoad)
    )
  },

  insertBefore: function (other) {
    if (!other) return
    this.parentPane.insertBefore(this.pane, other.pane)
  },

  insertAfter: function (other) {
    if (!other) return
    this.parentPane.insertBefore(this.pane, other.pane.nextSibling)
  },

  bringToTop: function () {
    this.parentPane.appendChild(this.pane)
  },

  hasDataVisible: function () {
    return this.layer.hasDataVisible()
  },

  resetLayer: function (force) {
    // Only reset if type is defined (undefined is the default) and different from current type
    if (
      this.layer &&
      (!this.options.type || this.options.type === this.layer.getType()) &&
      !force
    ) {
      return
    }
    const visible = this.isVisible()
    if (this.layer) this.layer.clearLayers()
    // delete this.layer?
    if (visible) this.map.removeLayer(this.layer)
    const Class = L.U.Layer[this.options.type] || L.U.Layer.Default
    this.layer = new Class(this)
    this.eachLayer(this.showFeature)
    if (visible) this.show()
    this.propagateRemote()
  },

  eachLayer: function (method, context) {
    for (const i in this._layers) {
      method.call(context || this, this._layers[i])
    }
    return this
  },

  eachFeature: function (method, context) {
    if (this.layer && this.layer.canBrowse) {
      for (let i = 0; i < this._index.length; i++) {
        method.call(context || this, this._layers[this._index[i]])
      }
    }
    return this
  },

  fetchData: function () {
    if (!this.umap_id) return
    if (this._loading) return
    this._loading = true
    this.map.get(this._dataUrl(), {
      callback: function (geojson, response) {
        this._last_modified = response.getResponseHeader('Last-Modified')
        // FIXME: for now this property is set dynamically from backend
        // And thus it's not in the geojson file in the server
        // So do not let all options to be reset
        // Fix is a proper migration so all datalayers settings are
        // in DB, and we remove it from geojson flat files.
        if (geojson._umap_options) {
          geojson._umap_options.editMode = this.options.editMode
        }
        // In case of maps pre 1.0 still around
        if (geojson._storage) geojson._storage.editMode = this.options.editMode
        this.fromUmapGeoJSON(geojson)
        this.backupOptions()
        this.fire('loaded')
        this._loading = false
      },
      context: this,
    })
  },

  fromGeoJSON: function (geojson) {
    this.addData(geojson)
    this._geojson = geojson
    this._dataloaded = true
    this.fire('dataloaded')
    this.fire('datachanged')
  },

  fromUmapGeoJSON: function (geojson) {
    if (geojson._storage) geojson._umap_options = geojson._storage // Retrocompat
    if (geojson._umap_options) this.setOptions(geojson._umap_options)
    if (this.isRemoteLayer()) this.fetchRemoteData()
    else this.fromGeoJSON(geojson)
    this._loaded = true
  },

  clear: function () {
    this.layer.clearLayers()
    this._layers = {}
    this._index = Array()
    if (this._geojson) {
      this.backupData()
      this._geojson = null
    }
    this.fire('datachanged')
  },

  backupData: function () {
    this._geojson_bk = L.Util.CopyJSON(this._geojson)
  },

  reindex: function () {
    const features = []
    this.eachFeature((feature) => features.push(feature))
    L.Util.sortFeatures(features, this.map.getOption('sortKey'))
    this._index = []
    for (let i = 0; i < features.length; i++) {
      this._index.push(L.Util.stamp(features[i]))
    }
  },

  showAtZoom: function () {
    const from = parseInt(this.options.fromZoom, 10),
      to = parseInt(this.options.toZoom, 10),
      zoom = this.map.getZoom()
    return !((!isNaN(from) && zoom < from) || (!isNaN(to) && zoom > to))
  },

  fetchRemoteData: function (force) {
    if (!this.isRemoteLayer()) return
    if (!this.options.remoteData.dynamic && this.hasDataLoaded() && !force) return
    if (!this.isVisible()) return
    let url = this.map.localizeUrl(this.options.remoteData.url)
    if (this.options.remoteData.proxy)
      url = this.map.proxyUrl(url, this.options.remoteData.ttl)
    this.map.ajax({
      uri: url,
      verb: 'GET',
      callback: (raw) => {
        this.clear()
        this.rawToGeoJSON(raw, this.options.remoteData.format, (geojson) =>
          this.fromGeoJSON(geojson)
        )
      },
    })
  },

  onceLoaded: function (callback, context) {
    if (this.isLoaded()) callback.call(context || this, this)
    else this.once('loaded', callback, context)
    return this
  },

  onceDataLoaded: function (callback, context) {
    if (this.hasDataLoaded()) callback.call(context || this, this)
    else this.once('dataloaded', callback, context)
    return this
  },

  isLoaded: function () {
    return !this.umap_id || this._loaded
  },

  hasDataLoaded: function () {
    return this._dataloaded
  },

  setUmapId: function (id) {
    // Datalayer is null when listening creation form
    if (!this.umap_id && id) this.umap_id = id
  },

  backupOptions: function () {
    this._backupOptions = L.Util.CopyJSON(this.options)
  },

  resetOptions: function () {
    this.options = L.Util.CopyJSON(this._backupOptions)
  },

  setOptions: function (options) {
    this.options = L.Util.CopyJSON(L.U.DataLayer.prototype.options) // Start from fresh.
    this.updateOptions(options)
  },

  updateOptions: function (options) {
    L.Util.setOptions(this, options)
    this.resetLayer()
  },

  connectToMap: function () {
    const id = L.stamp(this)
    if (!this.map.datalayers[id]) {
      this.map.datalayers[id] = this
      if (L.Util.indexOf(this.map.datalayers_index, this) === -1)
        this.map.datalayers_index.push(this)
    }
    this.map.updateDatalayersControl()
  },

  _dataUrl: function () {
    const template = this.map.options.urls.datalayer_view

    let url = L.Util.template(template, {
      pk: this.umap_id,
      map_id: this.map.options.umap_id,
    })

    // No browser cache for owners/editors.
    if (this.map.hasEditMode()) url = `${url}?${Date.now()}`
    return url
  },

  isRemoteLayer: function () {
    return !!(
      this.options.remoteData &&
      this.options.remoteData.url &&
      this.options.remoteData.format
    )
  },

  isClustered: function () {
    return this.options.type === 'Cluster'
  },

  showFeature: function (feature) {
    const filterKeys = this.map.getFilterKeys(),
      filter = this.map.browser.options.filter
    if (filter && !feature.matchFilter(filter, filterKeys)) return
    if (!feature.matchFacets()) return
    this.layer.addLayer(feature)
  },

  addLayer: function (feature) {
    const id = L.stamp(feature)
    feature.connectToDataLayer(this)
    this._index.push(id)
    this._layers[id] = feature
    this.indexProperties(feature)
    this.map.features_index[feature.getSlug()] = feature
    this.showFeature(feature)
    if (this.hasDataLoaded()) this.fire('datachanged')
  },

  removeLayer: function (feature) {
    const id = L.stamp(feature)
    feature.disconnectFromDataLayer(this)
    this._index.splice(this._index.indexOf(id), 1)
    delete this._layers[id]
    this.layer.removeLayer(feature)
    delete this.map.features_index[feature.getSlug()]
    if (this.hasDataLoaded()) this.fire('datachanged')
  },

  indexProperties: function (feature) {
    for (const i in feature.properties)
      if (typeof feature.properties[i] !== 'object') this.indexProperty(i)
  },

  indexProperty: function (name) {
    if (!name) return
    if (name.indexOf('_') === 0) return
    if (L.Util.indexOf(this._propertiesIndex, name) !== -1) return
    this._propertiesIndex.push(name)
  },

  deindexProperty: function (name) {
    const idx = this._propertiesIndex.indexOf(name)
    if (idx !== -1) this._propertiesIndex.splice(idx, 1)
  },

  addData: function (geojson) {
    try {
      // Do not fail if remote data is somehow invalid,
      // otherwise the layer becomes uneditable.
      this.geojsonToFeatures(geojson)
    } catch (err) {
      console.log('Error with DataLayer', this.umap_id)
      console.error(err)
    }
  },

  addRawData: function (c, type) {
    this.rawToGeoJSON(c, type, (geojson) => this.addData(geojson))
  },

  rawToGeoJSON: function (c, type, callback) {
    const toDom = (x) => new DOMParser().parseFromString(x, 'text/xml')

    // TODO add a duck typing guessType
    if (type === 'csv') {
      csv2geojson.csv2geojson(
        c,
        {
          delimiter: 'auto',
          includeLatLon: false,
        },
        (err, result) => {
          if (err) {
            let message
            if (err.type === 'Error') {
              message = err.message
            } else {
              message = L._('{count} errors during import: {message}', {
                count: err.length,
                message: err[0].message,
              })
            }
            this.map.ui.alert({ content: message, level: 'error', duration: 10000 })
            console.log(err)
          }
          if (result && result.features.length) {
            callback(result)
          }
        }
      )
    } else if (type === 'gpx') {
      callback(toGeoJSON.gpx(toDom(c)))
    } else if (type === 'georss') {
      callback(GeoRSSToGeoJSON(toDom(c)))
    } else if (type === 'kml') {
      callback(toGeoJSON.kml(toDom(c)))
    } else if (type === 'osm') {
      let d
      try {
        d = JSON.parse(c)
      } catch (e) {
        d = toDom(c)
      }
      callback(osmtogeojson(d, { flatProperties: true }))
    } else if (type === 'geojson') {
      try {
        const gj = JSON.parse(c)
        callback(gj)
      } catch (err) {
        this.map.ui.alert({ content: `Invalid JSON file: ${err}` })
        return
      }
    }
  },

  geojsonToFeatures: function (geojson) {
    if (!geojson) return
    const features = geojson instanceof Array ? geojson : geojson.features
    let i
    let len
    let latlng
    let latlngs

    if (features) {
      L.Util.sortFeatures(features, this.map.getOption('sortKey'))
      for (i = 0, len = features.length; i < len; i++) {
        this.geojsonToFeatures(features[i])
      }
      return this
    }

    const geometry = geojson.type === 'Feature' ? geojson.geometry : geojson
    if (!geometry) return // null geometry is valid geojson.
    const coords = geometry.coordinates
    let layer
    let tmp

    switch (geometry.type) {
      case 'Point':
        try {
          latlng = L.GeoJSON.coordsToLatLng(coords)
        } catch (e) {
          console.error('Invalid latlng object from', coords)
          break
        }
        layer = this._pointToLayer(geojson, latlng)
        break

      case 'MultiLineString':
      case 'LineString':
        latlngs = L.GeoJSON.coordsToLatLngs(
          coords,
          geometry.type === 'LineString' ? 0 : 1
        )
        if (!latlngs.length) break
        layer = this._lineToLayer(geojson, latlngs)
        break

      case 'MultiPolygon':
      case 'Polygon':
        latlngs = L.GeoJSON.coordsToLatLngs(coords, geometry.type === 'Polygon' ? 1 : 2)
        layer = this._polygonToLayer(geojson, latlngs)
        break
      case 'GeometryCollection':
        return this.geojsonToFeatures(geometry.geometries)

      default:
        this.map.ui.alert({
          content: L._('Skipping unknown geometry.type: {type}', {
            type: geometry.type || 'undefined',
          }),
          level: 'error',
        })
    }
    if (layer) {
      this.addLayer(layer)
      return layer
    }
  },

  _pointToLayer: function (geojson, latlng) {
    return new L.U.Marker(this.map, latlng, { geojson: geojson, datalayer: this })
  },

  _lineToLayer: function (geojson, latlngs) {
    return new L.U.Polyline(this.map, latlngs, {
      geojson: geojson,
      datalayer: this,
      color: null,
    })
  },

  _polygonToLayer: function (geojson, latlngs) {
    // Ensure no empty hole
    // for (let i = latlngs.length - 1; i > 0; i--) {
    //     if (!latlngs.slice()[i].length) latlngs.splice(i, 1);
    // }
    return new L.U.Polygon(this.map, latlngs, { geojson: geojson, datalayer: this })
  },

  importRaw: function (raw, type) {
    this.addRawData(raw, type)
    this.isDirty = true
    this.zoomTo()
  },

  importFromFiles: function (files, type) {
    for (let i = 0, f; (f = files[i]); i++) {
      this.importFromFile(f, type)
    }
  },

  importFromFile: function (f, type) {
    const reader = new FileReader()
    type = type || L.Util.detectFileType(f)
    reader.readAsText(f)
    reader.onload = (e) => this.importRaw(e.target.result, type)
  },

  importFromUrl: function (url, type) {
    url = this.map.localizeUrl(url)
    this.map.xhr._ajax({
      verb: 'GET',
      uri: url,
      callback: (data) => this.importRaw(data, type),
    })
  },

  getColor: function () {
    return this.options.color || this.map.getOption('color')
  },

  getDeleteUrl: function () {
    return L.Util.template(this.map.options.urls.datalayer_delete, {
      pk: this.umap_id,
      map_id: this.map.options.umap_id,
    })
  },

  getVersionsUrl: function () {
    return L.Util.template(this.map.options.urls.datalayer_versions, {
      pk: this.umap_id,
      map_id: this.map.options.umap_id,
    })
  },

  getVersionUrl: function (name) {
    return L.Util.template(this.map.options.urls.datalayer_version, {
      pk: this.umap_id,
      map_id: this.map.options.umap_id,
      name: name,
    })
  },

  _delete: function () {
    this.isDeleted = true
    this.erase()
  },

  empty: function () {
    if (this.isRemoteLayer()) return
    this.clear()
    this.isDirty = true
  },

  clone: function () {
    const options = L.Util.CopyJSON(this.options)
    options.name = L._('Clone of {name}', { name: this.options.name })
    delete options.id
    const geojson = L.Util.CopyJSON(this._geojson),
      datalayer = this.map.createDataLayer(options)
    datalayer.fromGeoJSON(geojson)
    return datalayer
  },

  erase: function () {
    this.hide()
    delete this.map.datalayers[L.stamp(this)]
    this.map.datalayers_index.splice(this.getRank(), 1)
    this.parentPane.removeChild(this.pane)
    this.map.updateDatalayersControl()
    this.fire('erase')
    this._leaflet_events_bk = this._leaflet_events
    this.map.off('moveend', this.onMoveEnd, this)
    this.map.off('zoomend', this.onZoomEnd, this)
    this.off()
    this.clear()
    delete this._loaded
    delete this._dataloaded
  },

  reset: function () {
    if (!this.umap_id) this.erase()

    this.resetOptions()
    this.parentPane.appendChild(this.pane)
    if (this._leaflet_events_bk && !this._leaflet_events) {
      this._leaflet_events = this._leaflet_events_bk
    }
    this.clear()
    this.hide()
    if (this.isRemoteLayer()) this.fetchRemoteData()
    else if (this._geojson_bk) this.fromGeoJSON(this._geojson_bk)
    this._loaded = true
    this.show()
    this.isDirty = false
  },

  redraw: function () {
    if (!this.isVisible()) return
    this.hide()
    this.show()
  },

  edit: function () {
    if (!this.map.editEnabled || !this.isLoaded()) {
      return
    }
    const container = L.DomUtil.create('div', 'umap-layer-properties-container'),
      metadataFields = [
        'options.name',
        'options.description',
        ['options.type', { handler: 'LayerTypeChooser', label: L._('Type of layer') }],
        ['options.displayOnLoad', { label: L._('Display on load'), handler: 'Switch' }],
        [
          'options.browsable',
          {
            label: L._('Data is browsable'),
            handler: 'Switch',
            helpEntries: 'browsable',
          },
        ],
        [
          'options.inCaption',
          {
            label: L._('Show this layer in the caption'),
            handler: 'Switch',
          },
        ],
      ]
    const title = L.DomUtil.add('h3', '', container, L._('Layer properties'))
    let builder = new L.U.FormBuilder(this, metadataFields, {
      callback: function (e) {
        this.map.updateDatalayersControl()
        if (e.helper.field === 'options.type') {
          this.resetLayer()
          this.edit()
        }
      },
    })
    container.appendChild(builder.build())

    const redrawCallback = function (e) {
      const field = e.helper.field,
        builder = e.helper.builder
      this.hide()
      this.layer.onEdit(field, builder)
      this.show()
    }

    const layerOptions = this.layer.getEditableOptions()

    if (layerOptions.length) {
      builder = new L.U.FormBuilder(this, layerOptions, {
        id: 'datalayer-layer-properties',
        callback: redrawCallback,
      })
      const layerProperties = L.DomUtil.createFieldset(
        container,
        `${this.layer.getName()}: ${L._('settings')}`
      )
      layerProperties.appendChild(builder.build())
    }

    let shapeOptions = [
      'options.color',
      'options.iconClass',
      'options.iconUrl',
      'options.iconOpacity',
      'options.opacity',
      'options.stroke',
      'options.weight',
      'options.fill',
      'options.fillColor',
      'options.fillOpacity',
    ]

    builder = new L.U.FormBuilder(this, shapeOptions, {
      id: 'datalayer-advanced-properties',
      callback: redrawCallback,
    })
    const shapeProperties = L.DomUtil.createFieldset(container, L._('Shape properties'))
    shapeProperties.appendChild(builder.build())

    let optionsFields = [
      'options.smoothFactor',
      'options.dashArray',
      'options.zoomTo',
      'options.fromZoom',
      'options.toZoom',
      'options.labelKey',
    ]

    builder = new L.U.FormBuilder(this, optionsFields, {
      id: 'datalayer-advanced-properties',
      callback: redrawCallback,
    })
    const advancedProperties = L.DomUtil.createFieldset(
      container,
      L._('Advanced properties')
    )
    advancedProperties.appendChild(builder.build())

    const popupFields = [
      'options.popupShape',
      'options.popupTemplate',
      'options.popupContentTemplate',
      'options.showLabel',
      'options.labelDirection',
      'options.labelInteractive',
      'options.outlinkTarget',
      'options.interactive',
    ]
    builder = new L.U.FormBuilder(this, popupFields, { callback: redrawCallback })
    const popupFieldset = L.DomUtil.createFieldset(
      container,
      L._('Interaction options')
    )
    popupFieldset.appendChild(builder.build())

    if (!L.Util.isObject(this.options.remoteData)) {
      this.options.remoteData = {}
    }
    const remoteDataFields = [
      [
        'options.remoteData.url',
        { handler: 'Url', label: L._('Url'), helpEntries: 'formatURL' },
      ],
      ['options.remoteData.format', { handler: 'DataFormat', label: L._('Format') }],
      'options.fromZoom',
      'options.toZoom',
      [
        'options.remoteData.dynamic',
        { handler: 'Switch', label: L._('Dynamic'), helpEntries: 'dynamicRemoteData' },
      ],
      [
        'options.remoteData.licence',
        {
          label: L._('Licence'),
          helpText: L._('Please be sure the licence is compliant with your use.'),
        },
      ],
    ]
    if (this.map.options.urls.ajax_proxy) {
      remoteDataFields.push([
        'options.remoteData.proxy',
        {
          handler: 'Switch',
          label: L._('Proxy request'),
          helpEntries: 'proxyRemoteData',
        },
      ])
      remoteDataFields.push([
        'options.remoteData.ttl',
        { handler: 'ProxyTTLSelect', label: L._('Cache proxied request') },
      ])
    }

    const remoteDataContainer = L.DomUtil.createFieldset(container, L._('Remote data'))
    builder = new L.U.FormBuilder(this, remoteDataFields)
    remoteDataContainer.appendChild(builder.build())
    L.DomUtil.createButton(
      'button umap-verify',
      remoteDataContainer,
      L._('Verify remote URL'),
      () => this.fetchRemoteData(true),
      this
    )

    if (this.map.options.urls.datalayer_versions) this.buildVersionsFieldset(container)

    const advancedActions = L.DomUtil.createFieldset(container, L._('Advanced actions'))
    const advancedButtons = L.DomUtil.create('div', 'button-bar half', advancedActions)
    const deleteLink = L.DomUtil.createButton(
      'button delete_datalayer_button umap-delete',
      advancedButtons,
      L._('Delete'),
      function () {
        this._delete()
        this.map.ui.closePanel()
      },
      this
    )
    if (!this.isRemoteLayer()) {
      const emptyLink = L.DomUtil.createButton(
        'button umap-empty',
        advancedButtons,
        L._('Empty'),
        this.empty,
        this
      )
    }
    const cloneLink = L.DomUtil.createButton(
      'button umap-clone',
      advancedButtons,
      L._('Clone'),
      function () {
        const datalayer = this.clone()
        datalayer.edit()
      },
      this
    )
    if (this.umap_id) {
      const download = L.DomUtil.createLink(
        'button umap-download',
        advancedButtons,
        L._('Download'),
        this._dataUrl(),
        '_blank'
      )
    }
    this.map.ui.openPanel({ data: { html: container }, className: 'dark' })
  },

  getOwnOption: function (option) {
    if (L.Util.usableOption(this.options, option)) return this.options[option]
  },

  getOption: function (option, feature) {
    if (this.layer && this.layer.getOption) {
      const value = this.layer.getOption(option, feature)
      if (typeof value !== 'undefined') return value
    }
    if (typeof this.getOwnOption(option) !== 'undefined') {
      return this.getOwnOption(option)
    } else if (this.layer && this.layer.defaults && this.layer.defaults[option]) {
      return this.layer.defaults[option]
    } else {
      return this.map.getOption(option)
    }
  },

  buildVersionsFieldset: function (container) {
    const appendVersion = function (data) {
      const date = new Date(parseInt(data.at, 10))
      const content = `${date.toLocaleString(L.lang)} (${parseInt(data.size) / 1000}Kb)`
      const el = L.DomUtil.create('div', 'umap-datalayer-version', versionsContainer)
      const button = L.DomUtil.createButton(
        '',
        el,
        '',
        () => this.restore(data.name),
        this
      )
      button.title = L._('Restore this version')
      L.DomUtil.add('span', '', el, content)
    }

    const versionsContainer = L.DomUtil.createFieldset(container, L._('Versions'), {
      callback: function () {
        this.map.xhr.get(this.getVersionsUrl(), {
          callback: function (data) {
            for (let i = 0; i < data.versions.length; i++) {
              appendVersion.call(this, data.versions[i])
            }
          },
          context: this,
        })
      },
      context: this,
    })
  },

  restore: function (version) {
    if (!this.map.editEnabled) return
    if (!confirm(L._('Are you sure you want to restore this version?'))) return
    this.map.xhr.get(this.getVersionUrl(version), {
      callback: function (geojson) {
        if (geojson._storage) geojson._umap_options = geojson._storage // Retrocompat.
        if (geojson._umap_options) this.setOptions(geojson._umap_options)
        this.empty()
        if (this.isRemoteLayer()) this.fetchRemoteData()
        else this.addData(geojson)
        this.isDirty = true
      },
      context: this,
    })
  },

  featuresToGeoJSON: function () {
    const features = []
    this.eachLayer((layer) => features.push(layer.toGeoJSON()))
    return features
  },

  show: function () {
    if (!this.isLoaded()) this.fetchData()
    this.map.addLayer(this.layer)
    this.fire('show')
  },

  hide: function () {
    this.map.removeLayer(this.layer)
    this.fire('hide')
  },

  toggle: function () {
    // From now on, do not try to how/hide
    // automatically this layer.
    this._forcedVisibility = true
    if (!this.isVisible()) this.show()
    else this.hide()
  },

  zoomTo: function () {
    if (!this.isVisible()) return
    const bounds = this.layer.getBounds()
    if (bounds.isValid()) this.map.fitBounds(bounds)
  },

  allowBrowse: function () {
    return !!this.options.browsable && this.canBrowse() && this.isVisible()
  },

  count: function () {
    return this._index.length
  },

  hasData: function () {
    return !!this._index.length
  },

  isVisible: function () {
    return this.layer && this.map.hasLayer(this.layer)
  },

  canBrowse: function () {
    return this.layer && this.layer.canBrowse
  },

  getFeatureByIndex: function (index) {
    if (index === -1) index = this._index.length - 1
    const id = this._index[index]
    return this._layers[id]
  },

  getNextFeature: function (feature) {
    const id = this._index.indexOf(L.stamp(feature))
    const nextId = this._index[id + 1]
    return nextId ? this._layers[nextId] : this.getNextBrowsable().getFeatureByIndex(0)
  },

  getPreviousFeature: function (feature) {
    if (this._index <= 1) {
      return null
    }
    const id = this._index.indexOf(L.stamp(feature))
    const previousId = this._index[id - 1]
    return previousId
      ? this._layers[previousId]
      : this.getPreviousBrowsable().getFeatureByIndex(-1)
  },

  getPreviousBrowsable: function () {
    let id = this.getRank()
    let next
    const index = this.map.datalayers_index
    while (((id = index[++id] ? id : 0), (next = index[id]))) {
      if (next === this || (next.allowBrowse() && next.hasData())) break
    }
    return next
  },

  getNextBrowsable: function () {
    let id = this.getRank()
    let prev
    const index = this.map.datalayers_index
    while (((id = index[--id] ? id : index.length - 1), (prev = index[id]))) {
      if (prev === this || (prev.allowBrowse() && prev.hasData())) break
    }
    return prev
  },

  umapGeoJSON: function () {
    return {
      type: 'FeatureCollection',
      features: this.isRemoteLayer() ? [] : this.featuresToGeoJSON(),
      _umap_options: this.options,
    }
  },

  getRank: function () {
    return this.map.datalayers_index.indexOf(this)
  },

  isReadOnly: function () {
    // isReadOnly must return true if unset
    return this.options.editMode === 'disabled'
  },

  isDataReadOnly: function () {
    // This layer cannot accept features
    return this.isReadOnly() || this.isRemoteLayer()
  },

  save: function () {
    if (this.isDeleted) return this.saveDelete()
    if (!this.isLoaded()) {
      return
    }
    const geojson = this.umapGeoJSON()
    const formData = new FormData()
    formData.append('name', this.options.name)
    formData.append('display_on_load', !!this.options.displayOnLoad)
    formData.append('rank', this.getRank())
    formData.append('settings', JSON.stringify(this.options))
    // Filename support is shaky, don't do it for now.
    const blob = new Blob([JSON.stringify(geojson)], { type: 'application/json' })
    formData.append('geojson', blob)
    const saveUrl = this.map.urls.get('datalayer_save', {
      map_id: this.map.options.umap_id,
      pk: this.umap_id,
    })
    this.map.post(saveUrl, {
      data: formData,
      callback: function (data, response) {
        // Response contains geojson only if save has conflicted and conflicts have
        // been resolved. So we need to reload to get extra data (saved from someone else)
        if (data.geojson) {
          this.clear()
          this.fromGeoJSON(data.geojson)
        }
        this._geojson = geojson
        this._last_modified = response.getResponseHeader('Last-Modified')
        this.setUmapId(data.id)
        this.updateOptions(data)
        this.backupOptions()
        this.connectToMap()
        this._loaded = true
        this.redraw() // Needed for reordering features
        this.isDirty = false
        this.permissions.save()
      },
      context: this,
      headers: this._last_modified
        ? { 'If-Unmodified-Since': this._last_modified }
        : {},
    })
  },

  saveDelete: function () {
    const callback = function () {
      this.isDirty = false
      this.map.continueSaving()
    }
    if (!this.umap_id) return callback.call(this)
    this.map.xhr.post(this.getDeleteUrl(), {
      callback: callback,
      context: this,
    })
  },

  getMap: function () {
    return this.map
  },

  getName: function () {
    return this.options.name || L._('Untitled layer')
  },

  tableEdit: function () {
    if (this.isRemoteLayer() || !this.isVisible()) return
    const editor = new L.U.TableEditor(this)
    editor.edit()
  },
})