'use strict';
'require view.frpc_advanced_base as base';

var STYLE_ID = 'frpc-inline-compact-style-v3';
var SPRITE_ID = 'frpc-inline-icon-sprite';
var SVG_NS = 'http://www.w3.org/2000/svg';
var XLINK_NS = 'http://www.w3.org/1999/xlink';
var applying = false;

function compactText(en, zh) {
	var lang = '';
	try {
		lang = ((document.documentElement && document.documentElement.lang) || (L.env && L.env.lang) || '').toLowerCase();
	} catch (e) {}
	return lang.indexOf('zh') === 0 ? zh : en;
}

function svgNode(name, attrs) {
	var node = document.createElementNS(SVG_NS, name);
	attrs = attrs || {};
	for (var key in attrs)
		if (Object.prototype.hasOwnProperty.call(attrs, key))
			node.setAttribute(key, attrs[key]);
	return node;
}

var iconDefs = {
	activity: [['path', { d: 'M3 12h4l2-5 4 10 2-5h6' }]],
	route: [
		['circle', { cx: '5', cy: '6', r: '2' }],
		['circle', { cx: '19', cy: '6', r: '2' }],
		['circle', { cx: '12', cy: '18', r: '2' }],
		['path', { d: 'M7 6h10M6.5 7.5l4.3 8M17.5 7.5l-4.3 8' }]
	],
	shield: [
		['path', { d: 'M12 3l7 3v5c0 4.6-2.8 8.1-7 10-4.2-1.9-7-5.4-7-10V6l7-3z' }],
		['path', { d: 'M12 8v6M12 17h.01' }]
	],
	lock: [
		['rect', { x: '6', y: '10', width: '12', height: '10', rx: '2' }],
		['path', { d: 'M9 10V7a3 3 0 016 0v3M12 14v2' }]
	],
	panel: [
		['rect', { x: '4', y: '4', width: '16', height: '13', rx: '2' }],
		['path', { d: 'M8 21h8M10 17v4M14 17v4M8 8h8M8 12h5' }]
	],
	radio: [
		['circle', { cx: '12', cy: '12', r: '2' }],
		['path', { d: 'M8.5 8.5a5 5 0 000 7M15.5 8.5a5 5 0 010 7M5.5 5.5a9 9 0 000 13M18.5 5.5a9 9 0 010 13' }]
	],
	nodes: [
		['circle', { cx: '12', cy: '5', r: '2' }],
		['circle', { cx: '5', cy: '12', r: '2' }],
		['circle', { cx: '19', cy: '12', r: '2' }],
		['circle', { cx: '12', cy: '19', r: '2' }],
		['path', { d: 'M10.5 6.5L6.5 10.5M13.5 6.5l4 4M6.5 13.5l4 4M17.5 13.5l-4 4' }]
	],
	server: [
		['rect', { x: '4', y: '4', width: '16', height: '6', rx: '2' }],
		['rect', { x: '4', y: '14', width: '16', height: '6', rx: '2' }],
		['path', { d: 'M8 7h.01M8 17h.01M12 7h6M12 17h6' }]
	],
	globe: [
		['circle', { cx: '12', cy: '12', r: '9' }],
		['path', { d: 'M3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9S14.5 18.5 12 21M12 3C9.5 5.5 8.5 8.5 8.5 12s1 6.5 3.5 9' }]
	],
	plug: [['path', { d: 'M8 3v5M16 3v5M6 8h12v2a6 6 0 01-6 6v5M9 21h6' }]],
	code: [['path', { d: 'M8 8l-4 4 4 4M16 8l4 4-4 4M14 5l-4 14' }]],
	certificate: [
		['rect', { x: '4', y: '3', width: '13', height: '17', rx: '2' }],
		['path', { d: 'M8 7h5M8 11h5M8 15h3' }],
		['circle', { cx: '18', cy: '16', r: '3' }],
		['path', { d: 'M16.5 18.5L16 22l2-1 2 1-.5-3.5' }]
	],
	users: [
		['circle', { cx: '9', cy: '8', r: '3' }],
		['path', { d: 'M3 20v-2a5 5 0 015-5h2a5 5 0 015 5v2M16 6a3 3 0 010 6M17 13a5 5 0 014 5v2' }]
	],
	archive: [
		['rect', { x: '4', y: '5', width: '16', height: '15', rx: '2' }],
		['path', { d: 'M3 5h18V2H3v3M9 10h6M12 10v6M9.5 13.5L12 16l2.5-2.5' }]
	]
};

function ensureSprite() {
	if (document.getElementById(SPRITE_ID) || !document.body) return;
	var sprite = svgNode('svg', { id: SPRITE_ID, class: 'frpc-icon-sprite', 'aria-hidden': 'true', focusable: 'false' });
	for (var name in iconDefs) {
		if (!Object.prototype.hasOwnProperty.call(iconDefs, name)) continue;
		var symbol = svgNode('symbol', {
			id: 'frpc-icon-' + name,
			viewBox: '0 0 24 24',
			fill: 'none',
			stroke: 'currentColor',
			'stroke-linecap': 'round',
			'stroke-linejoin': 'round'
		});
		for (var i = 0; i < iconDefs[name].length; i++)
			symbol.appendChild(svgNode(iconDefs[name][i][0], iconDefs[name][i][1]));
		sprite.appendChild(symbol);
	}
	document.body.appendChild(sprite);
}

function makeIcon(name, className) {
	ensureSprite();
	var svg = svgNode('svg', {
		class: className || 'frpc-icon',
		viewBox: '0 0 24 24',
		'aria-hidden': 'true',
		focusable: 'false',
		fill: 'none',
		stroke: 'currentColor',
		'stroke-width': '1.8',
		'stroke-linecap': 'round',
		'stroke-linejoin': 'round'
	});
	var use = svgNode('use');
	use.setAttribute('href', '#frpc-icon-' + name);
	try { use.setAttributeNS(XLINK_NS, 'xlink:href', '#frpc-icon-' + name); } catch (e) {}
	svg.appendChild(use);
	return svg;
}

function ensureStyle() {
	if (document.getElementById(STYLE_ID)) return;
	var style = document.createElement('style');
	style.id = STYLE_ID;
	style.textContent = `
.frpc-icon-sprite{position:absolute!important;width:0!important;height:0!important;overflow:hidden!important;pointer-events:none!important}
.frpc-icon{display:inline-block;flex:0 0 auto;vertical-align:-2px;pointer-events:none;color:currentColor}
.frpc-tab-icon{width:17px;height:17px;stroke-width:1.8}
.frpc-card-icon,.frpc-backup-svg-icon,.frpc-group-svg-icon{width:16px;height:16px;stroke-width:2}
.frpc-inline-iconized>.frpc-group-icon,.frpc-inline-iconized>.frpc-rule-group-icon{display:none!important}

.frpc-advanced-root .cbi-tabmenu{display:flex;flex-wrap:wrap;align-items:stretch;gap:0;margin:0 0 10px;padding:0 8px;border-bottom:1px solid #e5e7eb;background:rgba(255,255,255,.76)}
.frpc-advanced-root .cbi-tabmenu>li{margin:0!important;padding:0!important;border:0!important;background:transparent!important;box-shadow:none!important}
.frpc-advanced-root .cbi-tabmenu>li>a{display:flex!important;align-items:center;gap:7px;padding:9px 12px 8px!important;border:0!important;border-bottom:2px solid transparent!important;background:transparent!important;color:#475569!important;font-weight:500;text-decoration:none!important}
.frpc-advanced-root .cbi-tabmenu>li.cbi-tab>a{color:#5267e9!important;border-bottom-color:#5b72f2!important;font-weight:600}
.frpc-advanced-root .frpc-mode-bar{padding:0 12px;margin-bottom:8px}

.frpc-main-compact-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px;align-items:stretch;box-sizing:border-box;width:calc(100% - 16px);max-width:1400px;margin:8px 0 6px 8px}
.frpc-main-compact-layout:not(.frpc-main-compact-layout-columns)>.frpc-main-compact-card:not(.frpc-main-compact-card-wide){height:100%}
.frpc-main-compact-column{display:flex;flex-direction:column;gap:10px;min-width:0;height:100%}
.frpc-main-compact-layout-columns .frpc-main-compact-column-left>.frpc-main-compact-card{flex:1 1 auto}
.frpc-main-compact-layout-columns .frpc-main-compact-column-right>.frpc-main-compact-card:last-child{flex:1 1 auto}
.frpc-main-compact-card{min-width:0;overflow:hidden;border:1px solid #dbe2ea;border-radius:6px;background:rgba(255,255,255,.88);box-shadow:0 1px 2px rgba(15,23,42,.035)}
.frpc-main-compact-card-wide{grid-column:1/-1}
.frpc-main-compact-card-title{display:flex;align-items:center;gap:7px;min-height:34px;box-sizing:border-box;padding:0 11px;border-bottom:1px solid #e5eaf0;background:rgba(248,250,252,.88);font-size:.88rem;line-height:1.2;font-weight:600;color:#1f2937}
.frpc-main-compact-card-body{padding:3px 10px 5px}
.frpc-main-compact-card .cbi-value{box-sizing:border-box;margin:0!important;padding:6px 0!important;border:0!important;display:grid!important;grid-template-columns:minmax(128px,34%) minmax(0,1fr);column-gap:10px;align-items:start;width:100%;min-height:0!important}
.frpc-main-compact-card .cbi-value.hidden{display:none!important}
.frpc-ui-basic .frpc-main-compact-card .frpc-advanced-field{display:none!important}
.frpc-main-compact-card .cbi-value+.cbi-value{border-top:1px solid rgba(226,232,240,.64)!important}
.frpc-main-compact-card .cbi-value-title{box-sizing:border-box;width:auto!important;max-width:none!important;padding:5px 0 0!important;text-align:left!important;white-space:normal;line-height:1.28;font-size:.82rem;color:#25324a}
.frpc-main-compact-card .cbi-value-field{box-sizing:border-box;width:100%!important;max-width:none!important;min-width:0;padding:0!important;margin-left:0!important}
.frpc-main-compact-card .cbi-value-description{max-width:390px!important;margin-top:2px!important;font-size:.71rem;line-height:1.3;color:#8a94aa}
.frpc-main-compact-card input[type=text],.frpc-main-compact-card input[type=password],.frpc-main-compact-card input[type=number],.frpc-main-compact-card select,.frpc-main-compact-card .cbi-dropdown{box-sizing:border-box;width:100%!important;max-width:380px!important;min-height:29px!important}
.frpc-main-compact-card input[type=checkbox]{margin-top:4px}
.frpc-main-compact-card-wide .frpc-main-compact-card-body{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);column-gap:18px;row-gap:0;padding:3px 10px 5px}
.frpc-main-compact-card-wide .cbi-value{grid-template-columns:minmax(135px,160px) minmax(0,1fr);column-gap:10px;border-top:0!important}
.frpc-main-compact-card-wide .cbi-value:nth-child(n+3){border-top:1px solid rgba(226,232,240,.64)!important}
.frpc-main-compact-card[data-frpc-card=includes] .cbi-dynlist,.frpc-main-compact-card[data-frpc-card=raw-toml] .cbi-dynlist{max-width:100%!important}

.frpc-backup-module{box-sizing:border-box;width:calc(100% - 16px)!important;max-width:1400px!important;margin:8px 0 6px 8px!important;border:1px solid #dbe2ea;border-radius:6px;background:rgba(255,255,255,.88);overflow:hidden;box-shadow:0 1px 2px rgba(15,23,42,.035)}
.frpc-backup-module>h4:first-child{display:flex!important;align-items:center!important;gap:7px!important;min-height:34px;box-sizing:border-box;margin:0!important;padding:0 11px!important;border-bottom:1px solid #e5eaf0;background:rgba(248,250,252,.88);font-size:.88rem!important;line-height:1.2;font-weight:600!important;color:#1f2937}
.frpc-backup-module>p:nth-child(2){margin:0!important;padding:7px 11px!important;border-bottom:1px solid #e5eaf0;font-size:.76rem!important;line-height:1.35!important;color:#64748b;opacity:1!important}
.frpc-backup-module .frp-panel-grid{border:0!important;border-radius:0!important}
.frpc-backup-module .frp-panel-grid>div{padding:12px!important}
.frpc-backup-module .frp-panel-grid+div{border:0!important;border-top:1px solid #e5eaf0!important;border-radius:0!important;padding:8px 11px!important;background:rgba(248,250,252,.55);font-size:.75rem!important;opacity:.78!important}

.modal.cbi-modal.frpc-left-modal .cbi-map,
.modal.cbi-modal.frpc-left-modal .cbi-section,
.modal.cbi-modal.frpc-left-modal .frpc-left-tabbed{box-sizing:border-box!important;width:100%!important;max-width:none!important;margin-left:0!important;margin-right:auto!important;text-align:left!important}
.modal.cbi-modal.frpc-left-modal .cbi-tabmenu{justify-content:flex-start!important;margin-left:0!important;margin-right:auto!important}
.modal.cbi-modal.frpc-left-modal .frpc-left-basic-pane{box-sizing:border-box!important;width:560px!important;max-width:calc(100% - 24px)!important;margin:0!important;padding:0 12px!important;text-align:left!important}
.modal.cbi-modal.frpc-left-modal .frpc-left-basic-pane .cbi-value{float:none!important;display:grid!important;grid-template-columns:140px minmax(0,360px)!important;column-gap:14px!important;align-items:start!important;justify-content:start!important;box-sizing:border-box!important;width:514px!important;max-width:100%!important;margin:0 0 10px 0!important;padding:0!important;text-align:left!important}
.modal.cbi-modal.frpc-left-modal .frpc-left-basic-pane .cbi-value.hidden{display:none!important}
.modal.cbi-modal.frpc-left-modal .frpc-left-basic-pane .cbi-value>.cbi-value-title{float:none!important;box-sizing:border-box!important;width:140px!important;max-width:140px!important;margin:0!important;padding:7px 0 0!important;text-align:left!important}
.modal.cbi-modal.frpc-left-modal .frpc-left-basic-pane .cbi-value>.cbi-value-field{float:none!important;box-sizing:border-box!important;width:360px!important;max-width:360px!important;margin:0!important;padding:0!important;text-align:left!important}
.modal.cbi-modal.frpc-left-modal .frpc-left-basic-pane .cbi-value-description{grid-column:2!important;margin-left:0!important;text-align:left!important}
.modal.cbi-modal.frpc-left-modal .frpc-left-basic-pane .cbi-value>.cbi-value-field input:not([type=checkbox]):not([type=radio]),
.modal.cbi-modal.frpc-left-modal .frpc-left-basic-pane .cbi-value>.cbi-value-field select,
.modal.cbi-modal.frpc-left-modal .frpc-left-basic-pane .cbi-value>.cbi-value-field textarea,
.modal.cbi-modal.frpc-left-modal .frpc-left-basic-pane .cbi-value>.cbi-value-field .cbi-dropdown{box-sizing:border-box!important;width:100%!important;max-width:360px!important}

.modal.cbi-modal.frpc-left-modal .frpc-adv-main,
.modal.cbi-modal.frpc-left-modal .frpc-rule-advanced-layout{column-gap:10px!important;row-gap:10px!important;align-items:stretch!important;margin-left:0!important;margin-right:auto!important}
.modal.cbi-modal.frpc-left-modal .frpc-adv-column,
.modal.cbi-modal.frpc-left-modal .frpc-rule-column{gap:10px!important}
.modal.cbi-modal.frpc-left-modal .frpc-adv-column-right,
.modal.cbi-modal.frpc-left-modal .frpc-rule-column-right{border-left:0!important;padding-left:0!important}
.modal.cbi-modal.frpc-left-modal .frpc-adv-auth,
.modal.cbi-modal.frpc-left-modal .frpc-adv-conn,
.modal.cbi-modal.frpc-left-modal .frpc-adv-tls,
.modal.cbi-modal.frpc-left-modal .frpc-oidc-group,
.modal.cbi-modal.frpc-left-modal .frpc-rule-group-access,
.modal.cbi-modal.frpc-left-modal .frpc-rule-group-transport,
.modal.cbi-modal.frpc-left-modal .frpc-rule-group-health,
.modal.cbi-modal.frpc-left-modal .frpc-rule-group-extension{box-sizing:border-box!important;min-width:0!important;overflow:hidden;border:1px solid #dbe2ea!important;border-radius:6px!important;background:rgba(255,255,255,.88)!important;padding:0 10px 8px!important;box-shadow:0 1px 2px rgba(15,23,42,.035)!important}
.modal.cbi-modal.frpc-left-modal .frpc-adv-group-title,
.modal.cbi-modal.frpc-left-modal .frpc-rule-group-title{display:flex!important;align-items:center!important;justify-content:flex-start!important;gap:7px!important;box-sizing:border-box!important;min-height:34px!important;margin:0 -10px 4px!important;padding:0 10px!important;border-bottom:1px solid #e5eaf0!important;background:rgba(248,250,252,.88)!important;color:#1f2937!important;font-size:.88rem!important;line-height:1.2!important;font-weight:600!important;text-align:left!important}
.modal.cbi-modal.frpc-left-modal .frpc-adv-main .cbi-value,
.modal.cbi-modal.frpc-left-modal .frpc-rule-advanced-layout .cbi-value{box-sizing:border-box!important;margin:0!important;padding:6px 0!important;border:0!important}
.modal.cbi-modal.frpc-left-modal .frpc-adv-main .cbi-value.hidden,
.modal.cbi-modal.frpc-left-modal .frpc-rule-advanced-layout .cbi-value.hidden{display:none!important}
.modal.cbi-modal.frpc-left-modal .frpc-adv-main .cbi-value+.cbi-value,
.modal.cbi-modal.frpc-left-modal .frpc-rule-advanced-layout .cbi-value+.cbi-value{border-top:1px solid rgba(226,232,240,.64)!important}

@media(min-width:1500px){.frpc-main-compact-layout,.frpc-backup-module{max-width:1360px!important}}
@media(max-width:1050px){.frpc-main-compact-card-wide .frpc-main-compact-card-body{grid-template-columns:1fr}.frpc-main-compact-card-wide .cbi-value:nth-child(n+2){border-top:1px solid rgba(226,232,240,.64)!important}.frpc-main-compact-card-wide .cbi-value{grid-template-columns:minmax(130px,34%) minmax(0,1fr)}}
@media(max-width:900px){.frpc-main-compact-layout{grid-template-columns:1fr;gap:8px;width:100%;margin:6px 0}.frpc-main-compact-column{gap:8px}.frpc-backup-module{width:100%!important;margin:6px 0!important}.frpc-main-compact-card-wide{grid-column:auto}.frpc-main-compact-card input[type=text],.frpc-main-compact-card input[type=password],.frpc-main-compact-card input[type=number],.frpc-main-compact-card select,.frpc-main-compact-card .cbi-dropdown{max-width:100%!important}}
@media(max-width:620px){.frpc-main-compact-card .cbi-value,.frpc-main-compact-card-wide .cbi-value{grid-template-columns:1fr;row-gap:3px}.frpc-main-compact-card .cbi-value-title{padding-top:1px!important}.frpc-main-compact-card-body,.frpc-main-compact-card-wide .frpc-main-compact-card-body{padding:3px 8px 5px}.frpc-tab-icon{width:15px;height:15px}.modal.cbi-modal.frpc-left-modal .frpc-left-basic-pane{width:100%!important;max-width:100%!important;padding:0!important}.modal.cbi-modal.frpc-left-modal .frpc-left-basic-pane .cbi-value{grid-template-columns:1fr!important;row-gap:4px!important;width:100%!important;max-width:100%!important}.modal.cbi-modal.frpc-left-modal .frpc-left-basic-pane .cbi-value>.cbi-value-title,.modal.cbi-modal.frpc-left-modal .frpc-left-basic-pane .cbi-value>.cbi-value-field{width:100%!important;max-width:100%!important}.modal.cbi-modal.frpc-left-modal .frpc-left-basic-pane .cbi-value-description{grid-column:1!important}}
`;
	document.head.appendChild(style);
}

function decorateTabs(root) {
	var icons = { general: 'activity', transport: 'radio', manage: 'panel', extensions: 'nodes' };
	var items = root.querySelectorAll('.cbi-tabmenu > li');
	for (var i = 0; i < items.length; i++) {
		var a = items[i].querySelector('a');
		if (!a || a.querySelector('.frpc-tab-icon')) continue;
		var tab = items[i].getAttribute('data-tab') || a.getAttribute('data-tab') || '';
		if (!icons[tab]) continue;
		a.insertBefore(makeIcon(icons[tab], 'frpc-icon frpc-tab-icon'), a.firstChild);
	}
}

function iconizeHeading(heading, icon) {
	if (!heading || heading.classList.contains('frpc-inline-iconized')) return;
	heading.classList.add('frpc-inline-iconized');
	heading.insertBefore(makeIcon(icon, 'frpc-icon frpc-group-svg-icon'), heading.firstChild);
}

function directTabPane(tabbed, name) {
	if (!tabbed) return null;
	for (var i = 0; i < tabbed.children.length; i++) {
		var child = tabbed.children[i];
		if (child.getAttribute && child.getAttribute('data-tab') === name)
			return child;
	}
	return null;
}

function decorateModals() {
	var specs = [
		['.frpc-adv-auth .frpc-adv-group-title', 'lock'],
		['.frpc-adv-conn .frpc-adv-group-title', 'route'],
		['.frpc-adv-tls .frpc-adv-group-title', 'shield'],
		['.frpc-oidc-group .frpc-adv-group-title', 'users'],
		['.frpc-rule-group-access .frpc-rule-group-title', 'route'],
		['.frpc-rule-group-transport .frpc-rule-group-title', 'radio'],
		['.frpc-rule-group-health .frpc-rule-group-title', 'activity'],
		['.frpc-rule-group-extension .frpc-rule-group-title', 'nodes']
	];
	for (var s = 0; s < specs.length; s++) {
		var headings = document.querySelectorAll(specs[s][0]);
		for (var h = 0; h < headings.length; h++)
			iconizeHeading(headings[h], specs[s][1]);
	}

	var modals = document.querySelectorAll('.modal.cbi-modal');
	for (var m = 0; m < modals.length; m++) {
		var tabbed = modals[m].querySelector('.cbi-section-node-tabbed');
		if (!tabbed) continue;
		modals[m].classList.add('frpc-left-modal');
		tabbed.classList.add('frpc-left-tabbed');
		var basic = directTabPane(tabbed, 'basic');
		if (basic) basic.classList.add('frpc-left-basic-pane');
	}
}

function findRow(scope, name) {
	return scope.querySelector('[id$="-' + name + '"]');
}

function findTabHost(scope, firstRow, tabName, rows) {
	var node = firstRow ? firstRow.parentElement : null;
	while (node && node !== scope) {
		var all = true;
		for (var i = 0; i < rows.length; i++) {
			if (!node.contains(rows[i])) { all = false; break; }
		}
		if (all) {
			var tab = node.getAttribute && node.getAttribute('data-tab');
			if (tab === tabName || (node.classList && node.classList.contains('cbi-tabcontainer')))
				return node;
		}
		node = node.parentElement;
	}
	return firstRow ? firstRow.parentElement : null;
}

function directChildUnder(node, ancestor) {
	var cur = node;
	while (cur && cur.parentElement && cur.parentElement !== ancestor)
		cur = cur.parentElement;
	return cur;
}

function makeCard(scope, spec) {
	var rows = [];
	for (var i = 0; i < spec.fields.length; i++) {
		var row = findRow(scope, spec.fields[i]);
		if (row) rows.push(row);
	}
	if (!rows.length) return null;

	var body = document.createElement('div');
	body.className = 'frpc-main-compact-card-body';
	for (var r = 0; r < rows.length; r++) body.appendChild(rows[r]);

	var title = document.createElement('div');
	title.className = 'frpc-main-compact-card-title';
	title.appendChild(makeIcon(spec.icon, 'frpc-icon frpc-card-icon'));
	var text = document.createElement('span');
	text.textContent = compactText(spec.en, spec.zh);
	title.appendChild(text);

	var card = document.createElement('section');
	card.className = 'frpc-main-compact-card' + (spec.wide ? ' frpc-main-compact-card-wide' : '');
	card.setAttribute('data-frpc-card', spec.key);
	card.appendChild(title);
	card.appendChild(body);
	return card;
}

function buildLayout(scope, tabName, specs) {
	if (scope.querySelector('.frpc-main-compact-layout[data-frpc-tab="' + tabName + '"]')) return;

	var allRows = [];
	for (var s = 0; s < specs.length; s++) {
		for (var f = 0; f < specs[s].fields.length; f++) {
			var row = findRow(scope, specs[s].fields[f]);
			if (row && allRows.indexOf(row) < 0) allRows.push(row);
		}
	}
	if (!allRows.length) return;

	var host = findTabHost(scope, allRows[0], tabName, allRows);
	if (!host) return;
	for (var i = 0; i < allRows.length; i++)
		if (!host.contains(allRows[i])) return;

	var anchor = directChildUnder(allRows[0], host);
	var layout = document.createElement('div');
	layout.className = 'frpc-main-compact-layout';
	layout.setAttribute('data-frpc-tab', tabName);
	if (anchor && anchor.parentElement === host) host.insertBefore(layout, anchor);
	else host.appendChild(layout);

	var useColumns = false;
	for (var c0 = 0; c0 < specs.length; c0++) {
		if (specs[c0].column) { useColumns = true; break; }
	}

	var left = null, right = null;
	if (useColumns) {
		layout.classList.add('frpc-main-compact-layout-columns');
		left = document.createElement('div');
		right = document.createElement('div');
		left.className = 'frpc-main-compact-column frpc-main-compact-column-left';
		right.className = 'frpc-main-compact-column frpc-main-compact-column-right';
		layout.appendChild(left);
		layout.appendChild(right);
	}

	for (var c = 0; c < specs.length; c++) {
		var card = makeCard(scope, specs[c]);
		if (!card) continue;
		if (useColumns)
			(specs[c].column === 'right' ? right : left).appendChild(card);
		else
			layout.appendChild(card);
	}

	if ((useColumns && !left.children.length && !right.children.length) || (!useColumns && !layout.children.length))
		layout.remove();
}

function logicallyVisible(row, basic) {
	if (!row || row.hidden || row.classList.contains('hidden')) return false;
	if (basic && row.classList.contains('frpc-advanced-field')) return false;
	return true;
}

function refreshCards(root) {
	var basic = root.classList.contains('frpc-ui-basic');
	var cards = root.querySelectorAll('.frpc-main-compact-card');
	for (var i = 0; i < cards.length; i++) {
		var rows = cards[i].querySelectorAll('.cbi-value');
		var visible = false;
		for (var r = 0; r < rows.length; r++) {
			if (logicallyVisible(rows[r], basic)) { visible = true; break; }
		}
		cards[i].style.display = visible ? '' : 'none';
	}
	var layouts = root.querySelectorAll('.frpc-main-compact-layout');
	for (var l = 0; l < layouts.length; l++) {
		var layoutCards = layouts[l].querySelectorAll('.frpc-main-compact-card');
		var shown = false;
		for (var k = 0; k < layoutCards.length; k++) {
			if (layoutCards[k].style.display !== 'none') { shown = true; break; }
		}
		layouts[l].style.display = shown ? 'grid' : 'none';
	}
}

function styleBackup(root) {
	var importButton = root.querySelector('#frp-import-btn');
	if (!importButton || !importButton.closest) return;
	var panel = importButton.closest('.frp-panel-grid');
	var widget = panel && panel.parentElement;
	if (!widget || !widget.classList) return;
	widget.classList.add('frpc-backup-module');
	var heading = widget.querySelector('h4');
	if (heading && !heading.querySelector('.frpc-backup-svg-icon'))
		heading.insertBefore(makeIcon('archive', 'frpc-icon frpc-backup-svg-icon'), heading.firstChild);
}

function applyCompact(root) {
	if (!root || applying) return;
	applying = true;
	try {
		ensureStyle();
		ensureSprite();
		decorateTabs(root);
		var mainScope = root.querySelector('#cbi-frpc-advanced-main') || root;

		buildLayout(mainScope, 'general', [
			{ key: 'client-server', icon: 'server', en: 'Client & server', zh: '客户端与服务器', fields: ['enabled', 'client_file', 'run_user', 'server'] },
			{ key: 'runtime-policy', icon: 'activity', en: 'Runtime policy & logging', zh: '运行策略与日志', fields: ['respawn', 'clientID', 'user', 'loginFailExit', 'log__level'] }
		]);

		buildLayout(mainScope, 'transport', [
			{ key: 'connection', column: 'left', icon: 'plug', en: 'Connection & protocol', zh: '连接与协议', fields: ['transport__protocol', 'transport__wireProtocol', 'transport__poolCount', 'transport__dialServerTimeout', 'transport__dialServerKeepalive', 'transport__connectServerLocalIP'] },
			{ key: 'quic', column: 'right', icon: 'globe', en: 'QUIC & UDP', zh: 'QUIC 与 UDP', fields: ['transport__quic__keepalivePeriod', 'transport__quic__maxIdleTimeout', 'transport__quic__maxIncomingStreams', 'udpPacketSize'] },
			{ key: 'heartbeat', column: 'right', icon: 'activity', en: 'Heartbeat & keepalive', zh: '心跳与保活', fields: ['transport__heartbeatInterval', 'transport__heartbeatTimeout'] },
			{ key: 'network-nat', column: 'right', icon: 'route', en: 'Network & NAT', zh: '网络与 NAT', fields: ['transport__proxyURL', 'dnsServer', 'natHoleStunServer'] }
		]);

		buildLayout(mainScope, 'manage', [
			{ key: 'panel-access', icon: 'panel', en: 'Panel access', zh: '面板访问', fields: ['webServer__addr', 'webServer__port', 'webServer__user', 'webServer__password'] },
			{ key: 'panel-runtime', icon: 'code', en: 'Debug & storage', zh: '调试与存储', fields: ['webServer__assetsDir', 'webServer__pprofEnable', 'store__path'] },
			{ key: 'panel-tls', icon: 'certificate', en: 'Panel TLS', zh: '面板 TLS', wide: true, fields: ['webServer__tls__certFile', 'webServer__tls__keyFile'] }
		]);

		buildLayout(mainScope, 'extensions', [
			{ key: 'includes', icon: 'nodes', en: 'Additional proxy configurations', zh: '附加代理配置', fields: ['includes'] },
			{ key: 'raw-toml', icon: 'code', en: 'Raw TOML options', zh: '原始 TOML 选项', fields: ['com_extra_options'] }
		]);

		styleBackup(root);
		decorateModals();
		refreshCards(root);
	} finally {
		applying = false;
	}
}

function attach() {
	var root = document.querySelector('#view .frpc-advanced-root') || document.querySelector('.frpc-advanced-root');
	if (!root) return false;
	applyCompact(root);
	return true;
}

function observe() {
	if (!document.body || document.body.__frpcCompactObserverV2) return;
	var timer = null;
	var observer = new MutationObserver(function() {
		if (applying) return;
		if (timer) clearTimeout(timer);
		timer = setTimeout(function() {
			timer = null;
			attach();
			decorateModals();
		}, 0);
	});
	observer.observe(document.body, {
		childList: true,
		subtree: true,
		attributes: true,
		attributeFilter: ['class', 'hidden']
	});
	document.body.__frpcCompactObserverV2 = observer;
}

return base.constructor.extend({
	__init__: function() {
		attach();
		decorateModals();
		observe();
	}
});
