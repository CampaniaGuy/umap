import pytest
from playwright.sync_api import expect

from ..base import DataLayerFactory

pytestmark = pytest.mark.django_db


def getColors(elements):
    return [
        el.evaluate("e => window.getComputedStyle(e).backgroundColor")
        for el in elements.all()
    ]


DATALAYER_DATA1 = {
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "properties": {
                "mytype": "even",
                "name": "Point 2",
                "mynumber": 10,
                "mydate": "2024/04/14 12:19:17",
            },
            "geometry": {"type": "Point", "coordinates": [0.065918, 48.385442]},
        },
        {
            "type": "Feature",
            "properties": {
                "mytype": "odd",
                "name": "Point 1",
                "mynumber": 12,
                "mydate": "2024/03/13 12:20:20",
            },
            "geometry": {"type": "Point", "coordinates": [3.55957, 49.767074]},
        },
    ],
    "_umap_options": {
        "name": "Calque 1",
    },
}


DATALAYER_DATA2 = {
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "properties": {
                "mytype": "even",
                "name": "Point 4",
                "mynumber": 10,
                "mydate": "2024/08/18 13:14:15",
            },
            "geometry": {"type": "Point", "coordinates": [0.856934, 45.290347]},
        },
        {
            "type": "Feature",
            "properties": {
                "mytype": "odd",
                "name": "Point 3",
                "mynumber": 14,
                "mydate": "2024-04-14T10:19:17.000Z",
            },
            "geometry": {"type": "Point", "coordinates": [4.372559, 47.945786]},
        },
    ],
    "_umap_options": {
        "name": "Calque 2",
    },
}


def test_simple_equal_rule_at_load(live_server, page, map):
    map.settings["properties"]["rules"] = [
        {"condition": "mytype=odd", "options": {"color": "aliceblue"}}
    ]
    map.save()
    DataLayerFactory(map=map, data=DATALAYER_DATA1)
    DataLayerFactory(map=map, data=DATALAYER_DATA2)
    page.goto(f"{live_server.url}{map.get_absolute_url()}#6/48.948/1.670")
    markers = page.locator(".leaflet-marker-icon .icon_container")
    expect(markers).to_have_count(4)
    colors = getColors(markers)
    assert colors.count("rgb(240, 248, 255)") == 2


def test_simple_not_equal_rule_at_load(live_server, page, map):
    map.settings["properties"]["rules"] = [
        {"condition": "mytype!=even", "options": {"color": "aliceblue"}}
    ]
    map.save()
    DataLayerFactory(map=map, data=DATALAYER_DATA1)
    DataLayerFactory(map=map, data=DATALAYER_DATA2)
    page.goto(f"{live_server.url}{map.get_absolute_url()}#6/48.948/1.670")
    markers = page.locator(".leaflet-marker-icon .icon_container")
    expect(markers).to_have_count(4)
    colors = getColors(markers)
    assert colors.count("rgb(240, 248, 255)") == 2


def test_gt_rule_with_number_at_load(live_server, page, map):
    map.settings["properties"]["rules"] = [
        {"condition": "mynumber>10", "options": {"color": "aliceblue"}}
    ]
    map.save()
    DataLayerFactory(map=map, data=DATALAYER_DATA1)
    DataLayerFactory(map=map, data=DATALAYER_DATA2)
    page.goto(f"{live_server.url}{map.get_absolute_url()}#6/48.948/1.670")
    markers = page.locator(".leaflet-marker-icon .icon_container")
    expect(markers).to_have_count(4)
    colors = getColors(markers)
    assert colors.count("rgb(240, 248, 255)") == 2


def test_lt_rule_with_number_at_load(live_server, page, map):
    map.settings["properties"]["rules"] = [
        {"condition": "mynumber<14", "options": {"color": "aliceblue"}}
    ]
    map.save()
    DataLayerFactory(map=map, data=DATALAYER_DATA1)
    DataLayerFactory(map=map, data=DATALAYER_DATA2)
    page.goto(f"{live_server.url}{map.get_absolute_url()}#6/48.948/1.670")
    markers = page.locator(".leaflet-marker-icon .icon_container")
    expect(markers).to_have_count(4)
    colors = getColors(markers)
    assert colors.count("rgb(240, 248, 255)") == 3


def test_lt_rule_with_float_at_load(live_server, page, map):
    map.settings["properties"]["rules"] = [
        {"condition": "mynumber<12.3", "options": {"color": "aliceblue"}}
    ]
    map.save()
    DataLayerFactory(map=map, data=DATALAYER_DATA1)
    DataLayerFactory(map=map, data=DATALAYER_DATA2)
    page.goto(f"{live_server.url}{map.get_absolute_url()}#6/48.948/1.670")
    markers = page.locator(".leaflet-marker-icon .icon_container")
    expect(markers).to_have_count(4)
    colors = getColors(markers)
    assert colors.count("rgb(240, 248, 255)") == 3


def test_can_create_new_rule(live_server, page, openmap):
    DataLayerFactory(map=openmap, data=DATALAYER_DATA1)
    DataLayerFactory(map=openmap, data=DATALAYER_DATA2)
    page.goto(f"{live_server.url}{openmap.get_absolute_url()}#6/48.948/1.670")
    markers = page.locator(".leaflet-marker-icon .icon_container")
    expect(markers).to_have_count(4)
    page.get_by_role("button", name="Edit").click()
    page.get_by_role("link", name="Map advanced properties").click()
    page.get_by_role("heading", name="Conditional style rules").click()
    page.get_by_role("button", name="Add rule").click()
    page.locator("input[name=condition]").click()
    page.locator("input[name=condition]").fill("mytype=odd")
    page.locator(".umap-field-color .define").first.click()
    page.get_by_title("AliceBlue").first.click()
    colors = getColors(markers)
    assert colors.count("rgb(240, 248, 255)") == 2


def test_can_deactive_rule_from_list(live_server, page, openmap):
    openmap.settings["properties"]["rules"] = [
        {"condition": "mytype=odd", "options": {"color": "aliceblue"}}
    ]
    openmap.save()
    DataLayerFactory(map=openmap, data=DATALAYER_DATA1)
    DataLayerFactory(map=openmap, data=DATALAYER_DATA2)
    page.goto(f"{live_server.url}{openmap.get_absolute_url()}#6/48.948/1.670")
    markers = page.locator(".leaflet-marker-icon .icon_container")
    expect(markers).to_have_count(4)
    colors = getColors(markers)
    assert colors.count("rgb(240, 248, 255)") == 2
    page.get_by_role("button", name="Edit").click()
    page.get_by_role("link", name="Map advanced properties").click()
    page.get_by_role("heading", name="Conditional style rules").click()
    page.get_by_role("button", name="Show/hide layer").click()
    colors = getColors(markers)
    assert colors.count("rgb(240, 248, 255)") == 0
    page.get_by_role("button", name="Show/hide layer").click()
    colors = getColors(markers)
    assert colors.count("rgb(240, 248, 255)") == 2
