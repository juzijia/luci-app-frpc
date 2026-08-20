'use strict';
'require view';
'require form';
'require rpc';
'require uci';
'require ui';
'require dom';
'require poll';
'require tools.widgets as widgets';

const callGetStatus = rpc.declare({
	object: 'luci.frpc-advanced',
	method: 'get_status',
	expect: { '': { ok: false, running: false, instances: [] } }
});

const callGetVersion = rpc.declare({
	object: 'luci.frpc-advanced',
	method: 'get_version',
	expect: { '': { status: 'error', code: 'query_failed' } }
});

const callValidateBackup = rpc.declare({
	object: 'luci.frpc-advanced',
	method: 'validate_backup',
	params: ['config'],
	expect: { '': {} },
	reject: true
});

const callRestoreConfig = rpc.declare({
	object: 'luci.frpc-advanced',
	method: 'restore_config',
	params: ['config'],
	expect: { '': {} },
	reject: true
});

const callUciGetRaw = rpc.declare({ object: 'uci', method: 'get', params: ['config'], expect: { '': {} }, reject: true });


const BASIC_FIELDS = new Set([
	'enabled',
	'client_file',
	'server',
	'log__level',
	'transport__protocol',
	'webServer__addr',
	'webServer__port',
	'webServer__user',
	'webServer__password'
]);

const RULE_TYPES = ['tcp', 'udp', 'http', 'https', 'tcpmux', 'stcp', 'xtcp', 'sudp'];
const VISITOR_TYPES = ['stcp', 'xtcp', 'sudp'];

const ruleRequiredArmed = new Map();
const serverRequiredArmed = new Map();
const FRPC_FIELD_HELP = {
	'run_user': { body: _('Run FRPC as another system user to reduce privileges. Ensure that user can read the configuration, certificates, keys, and other required files.') },
	'webServer__addr': { body: _('Default is 127.0.0.1 for local access only. Set it to 0.0.0.0 to allow LAN access. WAN access is controlled by the OpenWrt / ImmortalWrt firewall rules. Configure a management panel username and password to prevent unauthorized access.') },
	'auth__method': { body: _('Token uses a shared secret between FRPC and FRPS. OIDC obtains an access token from an identity provider; use it only when the server is configured for OIDC authentication.') },
	'auth__tokenSource__file__path': { body: _('Reads the authentication token from a plain text file instead of storing it inline. Do not configure both an inline token and a token file.') },
	'auth__additionalScopes': { body: _('Extends authentication to HeartBeats and/or NewWorkConns. FRPS must enable matching additional scopes so heartbeat and new work connection requests remain authenticated.') },
	'auth__oidc__audience': { body: _('OIDC audience requested for the access token. Configure it only when the identity provider or FRPS requires a specific audience.') },
	'auth__oidc__tokenEndpointURL': { body: _('OIDC endpoint from which FRPC obtains an access token. Use the Token Endpoint provided by your identity provider.') },
	'auth__oidc__scope': { body: _('OIDC scopes requested when obtaining the access token. They must be allowed by the identity provider.') },
	'transport__tls__certFile': { body: _('TLS client authentication group: certFile and keyFile form the client certificate pair for mTLS; trustedCaFile verifies the FRPS certificate; serverName overrides the certificate name used for verification.') },
	'transport__bandwidthLimitMode': { body: _('Controls where the proxy bandwidth limit is enforced. Client applies the limit in FRPC; Server applies it in FRPS. Default leaves the setting unset, and FRP Core uses client-side enforcement.') },
	'hostHeaderRewrite': { body: _('Rewrites the HTTP Host header before forwarding the request to the local backend. Use it when the backend expects a specific virtual-host domain.') },
	'PlUgIn_type': { body: _('Uses an FRPC built-in plugin instead of normal local IP and port forwarding. Selecting a plugin changes which local backend fields are used.') },
	'serverName': { body: _('Visitor target proxy name. It must match the name of the remote STCP, XTCP, or SUDP proxy being accessed.') },
	'secretKey': { body: _('Shared authentication key for private STCP, XTCP, or SUDP proxies. The visitor and remote proxy must use the same key.') },
	'extra_options_plugin': { body: _('Raw TOML options appended to the selected plugin configuration. Invalid syntax or duplicate keys may make the generated FRPC configuration invalid.') }
};

function withFieldHelp(option) {
	const help = option && FRPC_FIELD_HELP[option.option];
	if (!help)
		return option;

	const render = option.render;
	option.render = function() {
		return Promise.resolve(render.apply(this, arguments)).then(function(row) {
			if (!row || typeof row.querySelector !== 'function')
				return row;
			const label = row.querySelector('.cbi-value-title');
			if (!label || label.querySelector('[data-frp-help="' + option.option + '"]'))
				return row;
			const title = help.title || label.textContent.trim();
			label.appendChild(E('span', {
				class: 'frp-help-icon',
				'data-frp-help': option.option,
				'data-tooltip': title + '\n' + help.body,
				'data-tooltip-style': 'frp-help-tooltip',
				tabindex: '0',
				'aria-label': title
			}, '\u24D8'));
			return row;
		});
	};
	return option;
}

function isRuleRequiredArmed(sectionId) {
	return ruleRequiredArmed.get(sectionId) === true;
}

function isServerRequiredArmed(sectionId) {
	return serverRequiredArmed.get(sectionId) === true;
}

function setSwitch(option, defaultValue) {
	option.enabled = '1';
	option.disabled = '0';
	if (defaultValue != null)
		option.default = defaultValue ? '1' : '0';
	return option;
}

function frpcBoolDefaultFalse(option) {
	option.enabled = 'true';
	option.disabled = 'false';
	option.cfgvalue = function(sectionId) {
		var val = this.map.data.get('frpc-advanced', sectionId, this.option);
		return (val != null) ? val : 'false';
	};
	option.write = function(sectionId, value) {
		if (value === 'true')
			this.map.data.set('frpc-advanced', sectionId, this.option, 'true');
		else
			this.map.data.unset('frpc-advanced', sectionId, this.option);
		return true;
	};
	option.remove = function(sectionId) {
		this.map.data.unset('frpc-advanced', sectionId, this.option);
	};
	return option;
}

function frpcBoolDefaultTrue(option) {
	option.enabled = 'true';
	option.disabled = 'false';
	option.cfgvalue = function(sectionId) {
		var val = this.map.data.get('frpc-advanced', sectionId, this.option);
		return (val != null) ? val : 'true';
	};
	option.write = function(sectionId, value) {
		if (value === 'false')
			this.map.data.set('frpc-advanced', sectionId, this.option, 'false');
		else
			this.map.data.unset('frpc-advanced', sectionId, this.option);
		return true;
	};
	option.remove = function(sectionId) {
		this.map.data.unset('frpc-advanced', sectionId, this.option);
	};
	return option;
}

function optionValue(map, optionName, sectionId) {
	const found = map.lookupOption(optionName, sectionId);
	if (!found || !found[0])
		return null;
	return found[0].formvalue(sectionId);
}

function markAdvancedOption(option) {
	const render = option.render;
	option.render = function() {
		return Promise.resolve(render.apply(this, arguments)).then((row) => {
			if (row && row.classList)
				row.classList.add('frpc-advanced-field');
			return row;
		});
	};
}

function gridOnly(option) {
	const render = option.render;
	option.render = function() {
		if (this.map && this.map.parent)
			return E([]);
		return render.apply(this, arguments);
	};
	return option;
}

function normalizeServiceStatus(status) {
	const enabled = uci.get('frpc-advanced', 'main', 'enabled') === '1';
	const instances = status && Array.isArray(status.instances) ? status.instances : [];
	const running = status && status.running === true;
	return {
		ok: !!(status && status.ok),
		running: running,
		enabled: enabled,
		start_failed: enabled && instances.length > 0 && !running
	};
}

function getServiceStatus() {
	return L.resolveDefault(callGetStatus(), { ok: false, running: false, instances: [] })
		.then(normalizeServiceStatus);
}

function renderStatus(status) {
	let color, text;
	if (!status || !status.ok) {
		color = 'orange';
		text = _('Unable to read service status');
	} else if (!status.enabled) {
		color = 'gray';
		text = _('Frp client not enabled');
	} else if (status.running) {
		color = 'green';
		text = _('Frp client running');
	} else if (status.start_failed === true) {
		color = 'red';
		text = _('Frp client start failed');
	} else {
		color = '#b45309';
		text = _('Frp client stopped');
	}
	return String.format('<em><span style="color:%s"><strong>%s</strong></span></em>', color, text);
}

function addStyleOnce() {
	if (document.getElementById('frpc-advanced-style'))
		return;

	document.head.appendChild(E('style', {
		id: 'frpc-advanced-style',
		type: 'text/css'
	}, `
		.frpc-ui-basic .frpc-advanced-field { display: none; }
		.frpc-page-description { margin: 0 0 8px; }
		.frpc-status-panel { margin: 0 0 8px; }
		.frpc-status-panel .cbi-section, .frpc-status-panel p { margin: 0; }
		.frp-help-icon { display: inline-block; cursor: help; margin-left: 5px; color: #818cf8; font-weight: bold; font-size: .88rem; position: relative; vertical-align: middle; user-select: none; -webkit-user-select: none; }
		.cbi-tooltip.frp-help-tooltip { box-sizing: border-box; background: #1e293b; color: #f1f5f9; padding: 10px 14px; border-radius: 8px; font-size: .82rem; font-weight: normal; white-space: pre-line; line-height: 1.45; box-shadow: 0 6px 18px rgba(0,0,0,.28); pointer-events: none; width: max-content; max-width: min(420px,calc(100vw - 24px)); overflow-wrap: anywhere; word-break: normal; }
		.frpc-advanced-root .frp-version-line { margin-top: 6px; font-size: .82rem; }
		.frpc-advanced-root .frp-version-label { color: #64748b; }
		.frpc-advanced-root .frp-version-value { font-weight: 600; color: #334155; background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 6px; padding: 1px 8px; margin-left: 4px; font-size: .85rem; }
		.frpc-advanced-root .frp-version-checking, .frpc-advanced-root .frp-version-pending { color: #64748b; }
		.frpc-advanced-root .frp-version-missing { color: #b45309; }
		.frpc-advanced-root .frp-version-error { color: #9a3412; }
		.frpc-mode-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; box-sizing: border-box; margin-bottom: 12px; padding: 0 16px; }
		.frpc-mode-title { flex: 0 0 auto; font-size: .88rem; color: #1f2937; white-space: nowrap; }
		.frpc-mode-buttons { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
		.frpc-mode-desc { flex: 1 1 260px; min-width: 0; font-size: .8rem; line-height: 1.4; color: #6b7280; }
		.frpc-advanced-root td[data-name="_remote_entry"] { white-space: pre-line; }
		.frpc-advanced-root #cbi-frpc-advanced-rule th,
		.frpc-advanced-root #cbi-frpc-advanced-rule td { text-align: left; }
		.frpc-advanced-root #cbi-frpc-advanced-rule th:first-child,
		.frpc-advanced-root #cbi-frpc-advanced-rule td[data-name="enabled"] { width: 52px; min-width: 52px; text-align: center; }
		.frpc-rule-switch { position: relative; display: inline-block !important; box-sizing: border-box; width: 34px; height: 18px; vertical-align: middle; }
		.frpc-rule-switch > input[type="checkbox"] { position: absolute !important; inset: 0; z-index: 2; box-sizing: border-box; width: 34px !important; height: 18px !important; margin: 0 !important; opacity: 0; cursor: pointer; }
		.frpc-rule-switch > label { position: absolute !important; inset: 0 !important; display: block !important; box-sizing: border-box; width: 34px !important; height: 18px !important; margin: 0 !important; padding: 0 !important; border: 0 !important; border-radius: 999px !important; background: #94a3b8 !important; cursor: pointer; transition: background-color .16s ease; }
		.frpc-rule-switch > input[type="checkbox"]:checked + label { background: #16a34a !important; }
		.frpc-rule-switch > label::before { content: "" !important; position: absolute !important; top: 2px !important; left: 2px !important; box-sizing: border-box; width: 14px !important; height: 14px !important; border: 0 !important; border-radius: 50% !important; background: #fff !important; box-shadow: 0 1px 2px rgba(15, 23, 42, .35) !important; transform: none; transition: transform .16s ease; }
		.frpc-rule-switch > input[type="checkbox"]:checked + label::before { transform: translateX(16px); }
		.frpc-rule-switch > label::after { display: none !important; }
		.frpc-rule-switch > input[type="checkbox"]:focus-visible + label { outline: 2px solid #2563eb; outline-offset: 2px; }
		.frpc-rule-switch > input[type="checkbox"]:disabled + label { cursor: not-allowed; opacity: .65; }
		@media (min-width: 992px) {
			.frpc-advanced-root .cbi-value-title { text-align: left; white-space: normal; width: 220px; max-width: 220px; }
			.frpc-advanced-root td.cbi-value-title { padding-left: 0; padding-right: 16px; }
			.frpc-advanced-root .cbi-value-field { max-width: 520px; }
			.frpc-advanced-root .cbi-value-description { max-width: 520px; }
			.frpc-advanced-root .cbi-map-form { max-width: 100%; }
			.frpc-advanced-root #cbi-frpc-advanced-rule .cbi-section-table { table-layout: fixed; width: calc(100% - 32px); }
			.frpc-advanced-root #cbi-frpc-advanced-rule .cbi-section-table .tr > .th,
			.frpc-advanced-root #cbi-frpc-advanced-rule .cbi-section-table .tr > .td { box-sizing: border-box; padding: 7px 10px; vertical-align: middle; }
			.frpc-advanced-root #cbi-frpc-advanced-rule .cbi-section-table .tr > .th:first-child,
			.frpc-advanced-root #cbi-frpc-advanced-rule td[data-name="enabled"] { width: 66px !important; min-width: 66px; padding-left: 9px; padding-right: 9px; text-align: center !important; }
			.frpc-advanced-root #cbi-frpc-advanced-rule .cbi-section-table .tr > .th:nth-child(2),
			.frpc-advanced-root #cbi-frpc-advanced-rule td[data-name="_name_grid"] { width: 18% !important; text-align: left !important; }
			.frpc-advanced-root #cbi-frpc-advanced-rule .cbi-section-table .tr > .th:nth-child(3),
			.frpc-advanced-root #cbi-frpc-advanced-rule td[data-name="_type_grid"] { width: 9% !important; text-align: left !important; }
			.frpc-advanced-root #cbi-frpc-advanced-rule .cbi-section-table .tr > .th:nth-child(4),
			.frpc-advanced-root #cbi-frpc-advanced-rule td[data-name="_local_target"] { width: 24% !important; text-align: left !important; }
			.frpc-advanced-root #cbi-frpc-advanced-rule .cbi-section-table .tr > .th:nth-child(5),
			.frpc-advanced-root #cbi-frpc-advanced-rule td[data-name="_remote_entry"] { text-align: left !important; }
			.frpc-advanced-root #cbi-frpc-advanced-rule .cbi-section-actions { width: 177px !important; text-align: right !important; }
		}

		/* ---- FRPS server advanced modal: compact two-column layout ---- */
		.modal.cbi-modal .frpc-adv-main {
			display: grid;
			grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
			column-gap: 28px;
			align-items: start;
		}
		.modal.cbi-modal .frpc-adv-column {
			display: flex;
			flex-direction: column;
			gap: 20px;
			min-width: 0;
		}
		.modal.cbi-modal .frpc-adv-column-right {
			border-left: 1px solid #e2e8f0;
			padding-left: 28px;
		}
		.modal.cbi-modal .frpc-adv-auth,
		.modal.cbi-modal .frpc-adv-conn,
		.modal.cbi-modal .frpc-adv-tls,
		.modal.cbi-modal .frpc-oidc-group { min-width: 0; }
		.modal.cbi-modal .frpc-oidc-group.frpc-hidden { display: none; }

		/* Group titles: icon (CSS mask) + text, per-group color. */
		.frpc-adv-group-title {
			display: flex;
			align-items: center;
			gap: 6px;
			margin: 0 0 10px;
			font-weight: 600;
		}
		.modal.cbi-modal .frpc-adv-group-title { font-size: .9rem; }
		.modal.cbi-modal .frpc-adv-auth .frpc-adv-group-title,
		.modal.cbi-modal .frpc-adv-conn .frpc-adv-group-title,
		.modal.cbi-modal .frpc-adv-tls .frpc-adv-group-title { color: #2563eb; }
		.modal.cbi-modal .frpc-oidc-group .frpc-adv-group-title { color: #16a34a; }

		.frpc-group-icon {
			display: inline-block;
			width: 16px;
			height: 16px;
			flex: 0 0 16px;
			background-color: currentColor;
			mask-repeat: no-repeat;
			mask-position: center;
			mask-size: 16px 16px;
			-webkit-mask-repeat: no-repeat;
			-webkit-mask-position: center;
			-webkit-mask-size: 16px 16px;
		}
		.frpc-group-icon-auth {
			mask-image: url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2024%2024'%20fill='none'%20stroke='%23000'%20stroke-width='2'%20stroke-linecap='round'%20stroke-linejoin='round'%3E%3Crect%20x='5'%20y='11'%20width='14'%20height='9'%20rx='2'/%3E%3Cpath%20d='M8%2011V7a4%204%200%200%201%208%200v4'/%3E%3C/svg%3E");
			-webkit-mask-image: url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2024%2024'%20fill='none'%20stroke='%23000'%20stroke-width='2'%20stroke-linecap='round'%20stroke-linejoin='round'%3E%3Crect%20x='5'%20y='11'%20width='14'%20height='9'%20rx='2'/%3E%3Cpath%20d='M8%2011V7a4%204%200%200%201%208%200v4'/%3E%3C/svg%3E");
		}
		.frpc-group-icon-connection {
			mask-image: url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2024%2024'%20fill='none'%20stroke='%23000'%20stroke-width='2'%20stroke-linecap='round'%20stroke-linejoin='round'%3E%3Ccircle%20cx='12'%20cy='5'%20r='2.5'/%3E%3Ccircle%20cx='5'%20cy='19'%20r='2.5'/%3E%3Ccircle%20cx='19'%20cy='19'%20r='2.5'/%3E%3Cpath%20d='M12%207.5%205.8%2016.5M12%207.5l6.2%209'/%3E%3C/svg%3E");
			-webkit-mask-image: url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2024%2024'%20fill='none'%20stroke='%23000'%20stroke-width='2'%20stroke-linecap='round'%20stroke-linejoin='round'%3E%3Ccircle%20cx='12'%20cy='5'%20r='2.5'/%3E%3Ccircle%20cx='5'%20cy='19'%20r='2.5'/%3E%3Ccircle%20cx='19'%20cy='19'%20r='2.5'/%3E%3Cpath%20d='M12%207.5%205.8%2016.5M12%207.5l6.2%209'/%3E%3C/svg%3E");
		}
		.frpc-group-icon-tls {
			mask-image: url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2024%2024'%20fill='none'%20stroke='%23000'%20stroke-width='2'%20stroke-linecap='round'%20stroke-linejoin='round'%3E%3Cpath%20d='M12%203l7%203v5c0%204.4-3%207.6-7%209-4-1.4-7-4.6-7-9V6l7-3z'/%3E%3C/svg%3E");
			-webkit-mask-image: url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2024%2024'%20fill='none'%20stroke='%23000'%20stroke-width='2'%20stroke-linecap='round'%20stroke-linejoin='round'%3E%3Cpath%20d='M12%203l7%203v5c0%204.4-3%207.6-7%209-4-1.4-7-4.6-7-9V6l7-3z'/%3E%3C/svg%3E");
		}
		.frpc-group-icon-oidc {
			mask-image: url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2024%2024'%20fill='none'%20stroke='%23000'%20stroke-width='2'%20stroke-linecap='round'%20stroke-linejoin='round'%3E%3Ccircle%20cx='12'%20cy='8'%20r='4'/%3E%3Cpath%20d='M4%2020c1.2-3.6%204.3-6%208-6s6.8%202.4%208%206'/%3E%3C/svg%3E");
			-webkit-mask-image: url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2024%2024'%20fill='none'%20stroke='%23000'%20stroke-width='2'%20stroke-linecap='round'%20stroke-linejoin='round'%3E%3Ccircle%20cx='12'%20cy='8'%20r='4'/%3E%3Cpath%20d='M4%2020c1.2-3.6%204.3-6%208-6s6.8%202.4%208%206'/%3E%3C/svg%3E");
		}

		/* Compact label-control rows inside the advanced pane. */
		.modal.cbi-modal .frpc-adv-main .cbi-value {
			display: grid;
			grid-template-columns: 132px minmax(0, 1fr);
			column-gap: 12px;
			align-items: start;
			margin-bottom: 10px;
		}
		.modal.cbi-modal .frpc-adv-main label.cbi-value-title {
			width: auto;
			max-width: 132px;
			text-align: left;
			padding: 7px 0 0;
			box-sizing: border-box;
			line-height: 1.35;
		}
		.modal.cbi-modal .frpc-adv-main .cbi-value-field {
			margin-left: 0;
			width: 100%;
			max-width: 240px;
			min-width: 0;
		}
		.modal.cbi-modal .frpc-adv-main .cbi-value-field input:not([type="checkbox"]):not([type="radio"]),
		.modal.cbi-modal .frpc-adv-main .cbi-value-field select,
		.modal.cbi-modal .frpc-adv-main .cbi-value-field textarea,
		.modal.cbi-modal .frpc-adv-main .cbi-value-field .cbi-dropdown {
			width: 100%;
			max-width: 240px;
			min-width: 0;
			box-sizing: border-box;
		}
		.modal.cbi-modal .frpc-adv-main .cbi-value-description {
			margin: 4px 0 0;
			max-width: 240px;
			font-size: .78rem;
			line-height: 1.3;
		}

		/* Authentication / Connection Optimization: compact controls. */
		.modal.cbi-modal .frpc-adv-auth .cbi-value-field,
		.modal.cbi-modal .frpc-adv-conn .cbi-value-field {
			width: 100%;
			max-width: 240px;
			min-width: 0;
		}
		.modal.cbi-modal .frpc-adv-auth .cbi-value-field input:not([type="checkbox"]):not([type="radio"]),
		.modal.cbi-modal .frpc-adv-auth .cbi-value-field select,
		.modal.cbi-modal .frpc-adv-auth .cbi-value-field textarea,
		.modal.cbi-modal .frpc-adv-auth .cbi-value-field .cbi-dropdown,
		.modal.cbi-modal .frpc-adv-conn .cbi-value-field input:not([type="checkbox"]):not([type="radio"]),
		.modal.cbi-modal .frpc-adv-conn .cbi-value-field select,
		.modal.cbi-modal .frpc-adv-conn .cbi-value-field textarea,
		.modal.cbi-modal .frpc-adv-conn .cbi-value-field .cbi-dropdown {
			width: 100%;
			max-width: 240px;
			min-width: 0;
			box-sizing: border-box;
		}

		/* OIDC group: compact controls. */
		.modal.cbi-modal .frpc-oidc-group .cbi-value-field,
		.modal.cbi-modal .frpc-oidc-group .cbi-value-field input:not([type="checkbox"]):not([type="radio"]),
		.modal.cbi-modal .frpc-oidc-group .cbi-value-field select,
		.modal.cbi-modal .frpc-oidc-group .cbi-value-field textarea,
		.modal.cbi-modal .frpc-oidc-group .cbi-value-field .cbi-dropdown {
			width: 100%;
			max-width: 240px;
			min-width: 0;
			box-sizing: border-box;
		}

		/* Flag rows: checkbox first, then title (same line); description below, indented. */
		.modal.cbi-modal .frpc-adv-main .cbi-value.frpc-flag-row {
			display: flex;
			flex-direction: column;
			align-items: stretch;
			margin-bottom: 12px;
		}
		.modal.cbi-modal .frpc-flag-row .frpc-flag-head {
			display: flex;
			align-items: center;
			gap: 8px;
			min-height: 24px;
		}
		.modal.cbi-modal .frpc-flag-row .frpc-flag-head .cbi-value-title {
			width: auto;
			margin: 0;
			padding: 0;
			flex: 0 1 auto;
			box-sizing: border-box;
		}
		.modal.cbi-modal .frpc-flag-row .frpc-flag-head .cbi-checkbox {
			margin: 0;
			flex: 0 0 auto;
		}
		.modal.cbi-modal .frpc-flag-row > .cbi-value-field {
			margin-top: 4px;
			padding-left: 24px;
		}
		.modal.cbi-modal .frpc-flag-row .cbi-value-description {
			margin: 2px 0 0 24px;
			max-width: none;
		}
		.modal.cbi-modal .frpc-flag-row .cbi-value-description::before { display: none; }

		/* TLS lightweight text trigger + 2x2 detail grid. */
		.modal.cbi-modal .frpc-tls-trigger {
			display: inline-flex;
			align-items: center;
			gap: 6px;
			padding: 4px 0;
			margin: 14px 0 6px;
			border: 0;
			background: transparent;
			color: #2563eb;
			font-size: .85rem;
			cursor: pointer;
		}
		.modal.cbi-modal .frpc-tls-trigger:hover { text-decoration: underline; }
		.modal.cbi-modal .frpc-trigger-arrow {
			position: relative;
			display: inline-block;
			width: 12px;
			height: 12px;
			flex: 0 0 12px;
			box-sizing: border-box;
			transition: transform .15s ease;
			color: currentColor;
		}
		.modal.cbi-modal .frpc-trigger-arrow::before {
			content: "";
			position: absolute;
			top: 1px;
			left: 2px;
			width: 7px;
			height: 7px;
			border-right: 2px solid currentColor;
			border-bottom: 2px solid currentColor;
			transform: rotate(45deg);
			box-sizing: border-box;
		}
		.modal.cbi-modal .frpc-tls-trigger.frpc-open .frpc-trigger-arrow { transform: rotate(180deg); }
		.modal.cbi-modal .frpc-adv-main .frpc-tls-details {
			display: grid;
			grid-template-columns: 1fr;
			column-gap: 0;
			row-gap: 0;
			margin-top: 8px;
			width: 100%;
			max-width: 100%;
			box-sizing: border-box;
			min-width: 0;
		}
		.modal.cbi-modal .frpc-adv-main .frpc-tls-details[hidden] { display: none; }
		.modal.cbi-modal .frpc-adv-main .frpc-tls-details .cbi-value-field {
			width: 100%;
			max-width: none;
			min-width: 0;
		}
		.modal.cbi-modal .frpc-adv-main .frpc-tls-details .cbi-value-field input:not([type="checkbox"]):not([type="radio"]),
		.modal.cbi-modal .frpc-adv-main .frpc-tls-details .cbi-value-field select,
		.modal.cbi-modal .frpc-adv-main .frpc-tls-details .cbi-value-field textarea,
		.modal.cbi-modal .frpc-adv-main .frpc-tls-details .cbi-value-field .cbi-dropdown {
			width: 100%;
			max-width: none;
			min-width: 0;
			box-sizing: border-box;
		}

		@media (max-width: 899px) {
			.modal.cbi-modal .frpc-adv-main {
				grid-template-columns: 1fr;
				column-gap: 0;
				row-gap: 20px;
			}
			.modal.cbi-modal .frpc-adv-column { gap: 20px; }
			.modal.cbi-modal .frpc-adv-column-right {
				border-left: 0;
				padding-left: 0;
			}
			.modal.cbi-modal .frpc-adv-main .cbi-value-field,
			.modal.cbi-modal .frpc-adv-main .cbi-value-field input:not([type="checkbox"]):not([type="radio"]),
			.modal.cbi-modal .frpc-adv-main .cbi-value-field select,
			.modal.cbi-modal .frpc-adv-main .cbi-value-field textarea,
			.modal.cbi-modal .frpc-adv-main .cbi-value-field .cbi-dropdown {
				width: 100%;
				max-width: 100%;
				min-width: 0;
			}
		}

		@media (max-width: 560px) {
			.modal.cbi-modal .frpc-adv-main .cbi-value:not(.frpc-flag-row) {
				display: flex;
				flex-direction: column;
				align-items: stretch;
			}
			.modal.cbi-modal .frpc-adv-main label.cbi-value-title {
				width: 100%;
				max-width: none;
				padding: 0 0 6px;
			}
		}

		/* ---- FRPS rule advanced modal: compact independent columns ---- */
		.modal.cbi-modal .frpc-rule-advanced-layout {
			display: grid;
			grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
			column-gap: 28px;
			align-items: start;
		}
		.modal.cbi-modal .frpc-rule-column {
			display: flex;
			flex-direction: column;
			gap: 20px;
			min-width: 0;
		}
		.modal.cbi-modal .frpc-rule-column-right {
			border-left: 1px solid rgba(0, 0, 0, .10);
			padding-left: 28px;
		}
		.modal.cbi-modal .frpc-rule-group-access,
		.modal.cbi-modal .frpc-rule-group-transport,
		.modal.cbi-modal .frpc-rule-group-health,
		.modal.cbi-modal .frpc-rule-group-extension { min-width: 0; }
		.modal.cbi-modal .frpc-rule-group-empty { display: none; }

		/* Rule group titles + CSS-mask icons. */
		.frpc-rule-group-title {
			display: flex;
			align-items: center;
			gap: 6px;
			margin: 0 0 10px;
			font-weight: 600;
		}
		.modal.cbi-modal .frpc-rule-group-title { font-size: .9rem; }
		.modal.cbi-modal .frpc-rule-group-access .frpc-rule-group-title,
		.modal.cbi-modal .frpc-rule-group-transport .frpc-rule-group-title,
		.modal.cbi-modal .frpc-rule-group-health .frpc-rule-group-title { color: #2563eb; }
		.modal.cbi-modal .frpc-rule-group-extension .frpc-rule-group-title { color: #7c3aed; }

		.frpc-rule-group-icon {
			display: inline-block;
			width: 16px;
			height: 16px;
			flex: 0 0 16px;
			background-color: currentColor;
			mask-repeat: no-repeat;
			mask-position: center;
			mask-size: 16px 16px;
			-webkit-mask-repeat: no-repeat;
			-webkit-mask-position: center;
			-webkit-mask-size: 16px 16px;
		}
		.frpc-rule-group-icon-access {
			mask-image: url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2024%2024'%20fill='none'%20stroke='%23000'%20stroke-width='2'%20stroke-linecap='round'%20stroke-linejoin='round'%3E%3Crect%20x='5'%20y='11'%20width='14'%20height='9'%20rx='2'/%3E%3Cpath%20d='M8%2011V7a4%204%200%200%201%208%200v4'/%3E%3C/svg%3E");
			-webkit-mask-image: url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2024%2024'%20fill='none'%20stroke='%23000'%20stroke-width='2'%20stroke-linecap='round'%20stroke-linejoin='round'%3E%3Crect%20x='5'%20y='11'%20width='14'%20height='9'%20rx='2'/%3E%3Cpath%20d='M8%2011V7a4%204%200%200%201%208%200v4'/%3E%3C/svg%3E");
		}
		.frpc-rule-group-icon-transport {
			mask-image: url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2024%2024'%20fill='none'%20stroke='%23000'%20stroke-width='2'%20stroke-linecap='round'%20stroke-linejoin='round'%3E%3Cpath%20d='M6%204v12M6%204L3%207M6%204l3%203M18%2020V8M18%2020l3-3M18%2020l-3-3'/%3E%3C/svg%3E");
			-webkit-mask-image: url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2024%2024'%20fill='none'%20stroke='%23000'%20stroke-width='2'%20stroke-linecap='round'%20stroke-linejoin='round'%3E%3Cpath%20d='M6%204v12M6%204L3%207M6%204l3%203M18%2020V8M18%2020l3-3M18%2020l-3-3'/%3E%3C/svg%3E");
		}
		.frpc-rule-group-icon-health {
			mask-image: url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2024%2024'%20fill='none'%20stroke='%23000'%20stroke-width='2'%20stroke-linecap='round'%20stroke-linejoin='round'%3E%3Cpath%20d='M3%2012h4l1.5-3.5L12%2017l2.5-8L16%2012h5'/%3E%3C/svg%3E");
			-webkit-mask-image: url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2024%2024'%20fill='none'%20stroke='%23000'%20stroke-width='2'%20stroke-linecap='round'%20stroke-linejoin='round'%3E%3Cpath%20d='M3%2012h4l1.5-3.5L12%2017l2.5-8L16%2012h5'/%3E%3C/svg%3E");
		}
		.frpc-rule-group-icon-extension {
			mask-image: url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2024%2024'%20fill='%23000'%3E%3Cpath%20d='M12%203a3%203%200%200%201%203%203h2a2%202%200%200%201%202%202v2a3%203%200%200%201%200%206v2a2%202%200%200%201-2%202h-2a3%203%200%200%201-6%200H7a2%202%200%200%201-2-2v-2a3%203%200%200%201%200-6V8a2%202%200%200%201%202-2h2a3%203%200%200%201%203-3z'/%3E%3C/svg%3E");
			-webkit-mask-image: url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2024%2024'%20fill='%23000'%3E%3Cpath%20d='M12%203a3%203%200%200%201%203%203h2a2%202%200%200%201%202%202v2a3%203%200%200%201%200%206v2a2%202%200%200%201-2%202h-2a3%203%200%200%201-6%200H7a2%202%200%200%201-2-2v-2a3%203%200%200%201%200-6V8a2%202%200%200%201%202-2h2a3%203%200%200%201%203-3z'/%3E%3C/svg%3E");
		}

		/* Preserve LuCI dependency visibility after regrouping. */
		.modal.cbi-modal .frpc-rule-advanced-layout .cbi-value.hidden { display: none !important; }

		/* Compact label-control rows inside rule groups. */
		.modal.cbi-modal .frpc-rule-advanced-layout .cbi-value {
			display: grid;
			grid-template-columns: 128px minmax(0, 1fr);
			column-gap: 12px;
			align-items: start;
			margin: 0 0 10px;
		}
		.modal.cbi-modal .frpc-rule-advanced-layout label.cbi-value-title {
			width: auto;
			max-width: 128px;
			text-align: left;
			padding: 7px 0 0;
			box-sizing: border-box;
			line-height: 1.35;
		}
		.modal.cbi-modal .frpc-rule-advanced-layout .cbi-value-field {
			margin-left: 0;
			width: 100%;
			max-width: 270px;
			min-width: 0;
		}
		.modal.cbi-modal .frpc-rule-advanced-layout .cbi-value-field input:not([type="checkbox"]):not([type="radio"]),
		.modal.cbi-modal .frpc-rule-advanced-layout .cbi-value-field select,
		.modal.cbi-modal .frpc-rule-advanced-layout .cbi-value-field textarea,
		.modal.cbi-modal .frpc-rule-advanced-layout .cbi-value-field .cbi-dropdown {
			width: 100%;
			max-width: 270px;
			min-width: 0;
			box-sizing: border-box;
		}
		.modal.cbi-modal .frpc-rule-advanced-layout .cbi-value-description {
			grid-column: 2;
			margin: 4px 0 0;
			max-width: 270px;
			font-size: .78rem;
			line-height: 1.3;
		}

		/* Keep LuCI password input and reveal/hide button on one row. */
		.modal.cbi-modal .frpc-rule-advanced-layout .cbi-value-field .control-group {
			display: flex;
			align-items: stretch;
			width: 100%;
			max-width: 100%;
			min-width: 0;
		}
		.modal.cbi-modal .frpc-rule-advanced-layout .cbi-value-field .control-group > input.cbi-input-password {
			flex: 1 1 auto;
			width: 0 !important;
			min-width: 0;
			max-width: none !important;
		}
		.modal.cbi-modal .frpc-rule-advanced-layout .cbi-value-field .control-group > button.cbi-button {
			flex: 0 0 auto;
			margin-left: 0;
		}

		/* Load balancer + health check: slightly narrower controls. */
		.modal.cbi-modal .frpc-rule-group-health .cbi-value-field,
		.modal.cbi-modal .frpc-rule-group-health .cbi-value-field input:not([type="checkbox"]):not([type="radio"]),
		.modal.cbi-modal .frpc-rule-group-health .cbi-value-field select,
		.modal.cbi-modal .frpc-rule-group-health .cbi-value-field textarea,
		.modal.cbi-modal .frpc-rule-group-health .cbi-value-field .cbi-dropdown {
			width: 100%;
			max-width: 260px;
			min-width: 0;
			box-sizing: border-box;
		}

		/* Dynamic/raw option controls stay compact but keep the add button inline. */
		.modal.cbi-modal .frpc-rule-group-access [data-name="allowUsers"] .cbi-value-field,
		.modal.cbi-modal .frpc-rule-group-access [data-name="locations"] .cbi-value-field,
		.modal.cbi-modal .frpc-rule-group-extension [data-name="extra_options"] .cbi-value-field,
		.modal.cbi-modal .frpc-rule-group-extension [data-name="extra_options_plugin"] .cbi-value-field {
			width: 100%;
			max-width: 300px;
			min-width: 0;
		}

		/* Rule flag rows: checkbox left, title right, description below (indented). */
		.modal.cbi-modal .frpc-rule-advanced-layout .cbi-value.frpc-rule-flag-row {
			display: flex;
			flex-direction: column;
			align-items: stretch;
			margin: 0 0 12px;
		}
		.frpc-rule-flag-head {
			display: flex;
			align-items: center;
			gap: 8px;
			min-height: 24px;
		}
		.modal.cbi-modal .frpc-rule-flag-head .cbi-value-title {
			width: auto;
			margin: 0;
			padding: 0;
			flex: 0 1 auto;
			box-sizing: border-box;
		}
		.modal.cbi-modal .frpc-rule-flag-head .cbi-checkbox {
			margin: 0;
			flex: 0 0 auto;
		}
		.modal.cbi-modal .frpc-rule-flag-row > .cbi-value-field { display: none; }
		.modal.cbi-modal .frpc-rule-flag-row .cbi-value-description {
			padding-left: 24px;
			margin-top: 4px;
			margin-left: 0;
		}
		.modal.cbi-modal .frpc-rule-flag-row .cbi-value-description::before { display: none; }

		@media (max-width: 899px) {
			.modal.cbi-modal .frpc-rule-advanced-layout {
				grid-template-columns: 1fr;
				column-gap: 0;
				row-gap: 20px;
			}
			.modal.cbi-modal .frpc-rule-column { display: contents; }
			.modal.cbi-modal .frpc-rule-group-access { grid-column: 1; grid-row: 1; }
			.modal.cbi-modal .frpc-rule-group-transport { grid-column: 1; grid-row: 2; }
			.modal.cbi-modal .frpc-rule-group-health { grid-column: 1; grid-row: 3; }
			.modal.cbi-modal .frpc-rule-group-extension { grid-column: 1; grid-row: 4; }
			.modal.cbi-modal .frpc-rule-column-right {
				border-left: 0;
				padding-left: 0;
			}
			.modal.cbi-modal .frpc-rule-advanced-layout .cbi-value-field,
			.modal.cbi-modal .frpc-rule-advanced-layout .cbi-value-field input:not([type="checkbox"]):not([type="radio"]),
			.modal.cbi-modal .frpc-rule-advanced-layout .cbi-value-field select,
			.modal.cbi-modal .frpc-rule-advanced-layout .cbi-value-field textarea,
			.modal.cbi-modal .frpc-rule-advanced-layout .cbi-value-field .cbi-dropdown {
				width: 100%;
				max-width: 100%;
				min-width: 0;
			}
		}

		@media (max-width: 600px) {
			.modal.cbi-modal .frpc-rule-advanced-layout .cbi-value:not(.frpc-rule-flag-row) {
				display: flex;
				flex-direction: column;
				align-items: stretch;
			}
			.modal.cbi-modal .frpc-rule-advanced-layout label.cbi-value-title {
				width: 100%;
				max-width: none;
				padding: 0 0 6px;
			}
			.modal.cbi-modal .frpc-rule-advanced-layout .cbi-value-description {
				margin-top: 4px;
				max-width: 100%;
			}
		}

	`));
}


function repairWidgetLabels(content) {
	const labels = content.querySelectorAll('label[for^="widget.cbid"]');
	for (const label of labels) {
		const widgetId = label.getAttribute('for');
		let input = content.querySelector(
			'input[data-widget-id="%s"], select[data-widget-id="%s"], textarea[data-widget-id="%s"]'
				.format(widgetId, widgetId, widgetId));
		if (!input)
			input = content.querySelector('[data-widget-id="widget.%s"]'.format(widgetId));
		if (input && input.id)
			label.setAttribute('for', input.id);
	}
}

function validateRuleName(sectionId, value) {
	if (!value) {
		if (isRuleRequiredArmed(sectionId))
			return _('Rule name is required.');
		return true;
	}

	let duplicate = false;
	this.map.data.sections('frpc-advanced', 'rule', (section) => {
		if (section['.name'] !== sectionId && section.name === value)
			duplicate = true;
	});
	return duplicate ? _('Rule names must be unique.') : true;
}

function validateRuleType(sectionId, value) {
	const visitor = optionValue(this.map, 'visitor', sectionId) === '1';
	if (visitor && !['stcp', 'xtcp', 'sudp'].includes(value))
		return _('Visitor mode supports only STCP, XTCP, and SUDP.');
	return true;
}

function validatePluginType(sectionId, value) {
	if (!value)
		return true;

	const visitor = optionValue(this.map, 'visitor', sectionId) === '1';
	const proxyType = optionValue(this.map, 'type', sectionId);
	if (visitor)
		return _('Visitor rules cannot use proxy plugins.');

	const compatible = {
		unix_domain_socket: ['tcp'],
		http_proxy: ['tcp'],
		socks5: ['tcp'],
		static_file: ['tcp'],
		http2http: ['tcp'],
		tls2raw: ['tcp'],
		https2http: ['https'],
		https2https: ['https'],
		http2https: ['http']
	};

	return compatible[value] && compatible[value].includes(proxyType)
		? true
		: _('The selected plugin is incompatible with this proxy type.');
}

function hasFormValue(value) {
	if (Array.isArray(value))
		return value.some((item) => String(item || '').trim() !== '');
	return String(value || '').trim() !== '';
}

function validateDomainPair(sectionId, value, otherOption) {
	if (hasFormValue(value) || hasFormValue(optionValue(this.map, otherOption, sectionId)))
		return true;
	if (!isRuleRequiredArmed(sectionId))
		return true;
	return _('Enter a subdomain or at least one custom domain.');
}

function validatePluginRequired(sectionId, value, pluginTypes) {
	const selected = optionValue(this.map, 'PlUgIn_type', sectionId);
	if (!pluginTypes.includes(selected))
		return true;
	if (hasFormValue(value))
		return true;
	if (!isRuleRequiredArmed(sectionId))
		return true;
	return _('This field is required by the selected plugin.');
}


function isPlainObj(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const BACKUP_INTERNAL_MAIN_KEYS = new Set([
	'enabled', 'respawn', 'client_file', 'schema_version', 'run_user', 'server'
]);

function readCurrentSections() {
	return callUciGetRaw('frpc-advanced').then(function(raw) {
		if (!isPlainObj(raw)) throw new Error('UCI RPC did not return an object');
		const sections = isPlainObj(raw.values) ? raw.values : raw;
		if (!isPlainObj(sections)) throw new Error('UCI sections format invalid');
		if (!isPlainObj(sections.main)) throw new Error('No main section found');
		if (sections.main['.type'] !== 'frpc') throw new Error('main section type is not frpc');
		return sections;
	});
}

function copyBackupOptions(section, skip) {
	const output = {};
	for (const key in section) {
		if (key[0] === '.') continue;
		if (skip && skip.has(key)) continue;
		const value = section[key];
		if (value === null || value === undefined || typeof value === 'function') continue;
		if (typeof value === 'object' && !Array.isArray(value)) continue;
		output[key] = value;
	}
	return output;
}

function orderedSectionsByType(sections, type) {
	return Object.keys(sections)
		.filter(function(name) { return isPlainObj(sections[name]) && sections[name]['.type'] === type; })
		.sort(function(a, b) {
			const ai = Number(sections[a]['.index']);
			const bi = Number(sections[b]['.index']);
			if (Number.isFinite(ai) && Number.isFinite(bi) && ai !== bi) return ai - bi;
			return 0;
		});
}

function buildBackupPayload(sections) {
	const main = sections.main;
	const serverNames = orderedSectionsByType(sections, 'server');
	const ruleNames = orderedSectionsByType(sections, 'rule');
	const selectedId = String(main.server || '');

	if (serverNames.length > 0 && !serverNames.includes(selectedId))
		throw new Error(_('Current FRPS server selection is missing or stale.'));

	return {
		format: 'frpc-advanced-backup',
		schemaVersion: 1,
		settings: copyBackupOptions(main, BACKUP_INTERNAL_MAIN_KEYS),
		servers: serverNames.map(function(name) {
			return Object.assign({ selected: name === selectedId }, copyBackupOptions(sections[name], null));
		}),
		rules: ruleNames.map(function(name) {
			return copyBackupOptions(sections[name], null);
		})
	};
}

function validateImportBackup(data) {
	if (!isPlainObj(data)) throw new Error(_('Invalid backup format.'));
	const allowedTop = new Set(['format', 'schemaVersion', 'settings', 'servers', 'rules']);
	for (const key of Object.keys(data)) {
		if (!allowedTop.has(key)) throw new Error(_('Unsupported backup field: ') + key);
	}
	if (data.format !== 'frpc-advanced-backup') throw new Error(_('Unsupported format: ') + (data.format || 'none'));
	if (data.schemaVersion !== 1) throw new Error(_('Unsupported schema version: ') + (data.schemaVersion || 'none'));
	if (!isPlainObj(data.settings)) throw new Error(_('settings must be an object'));
	if (!Array.isArray(data.servers)) throw new Error(_('servers must be an array'));
	if (!Array.isArray(data.rules)) throw new Error(_('rules must be an array'));

	for (const key of Object.keys(data.settings)) {
		if (key[0] === '.' || BACKUP_INTERNAL_MAIN_KEYS.has(key))
			throw new Error(_('Internal setting is not allowed in backup: ') + key);
	}

	let selectedCount = 0;
	for (let i = 0; i < data.servers.length; i++) {
		const server = data.servers[i];
		if (!isPlainObj(server)) throw new Error(_('Server entry must be an object.'));
		if (typeof server.selected !== 'boolean') throw new Error(_('Each server must contain a boolean selected field.'));
		if (server.selected) selectedCount++;
		for (const key of Object.keys(server)) {
			if (key !== 'selected' && key[0] === '.') throw new Error(_('UCI metadata is not allowed in server backup data.'));
		}
	}
	if (data.servers.length > 0 && selectedCount !== 1)
		throw new Error(_('Exactly one server must be selected.'));

	for (let i = 0; i < data.rules.length; i++) {
		if (!isPlainObj(data.rules[i])) throw new Error(_('Rule entry must be an object.'));
		for (const key of Object.keys(data.rules[i])) {
			if (key[0] === '.') throw new Error(_('UCI metadata is not allowed in rule backup data.'));
		}
	}
}

function countBackupOptions(backup) {
	let count = Object.keys(backup.settings).length;
	for (const server of backup.servers)
		count += Object.keys(server).filter(function(key) { return key !== 'selected'; }).length;
	for (const rule of backup.rules)
		count += Object.keys(rule).length;
	return count;
}

function buildBackupRestoreWidget(map) {
	const HELP_TIP = _('Import will overwrite the current saved configuration. Local executable and service settings are preserved.');
	const restoreInlineStatus = map && map._frpcRestoreInlineStatus;
	let selectedBackupFile = null;
	let validatedBackupData = null;
	let importValidationError = null;
	let importInProgress = false;
	let backendValidationResult = null;
	let validationInProgress = false;

	const stEl = E('div', {
		style: 'display:none;margin-top:10px;padding:8px 10px;max-width:960px;border-radius:4px;font-size:13px;line-height:1.5;border:1px solid #e2e8f0;word-break:break-word'
	});
	const fi = E('input', { type: 'file', id: 'frp-file-input', accept: '.json,application/json', style: 'display:none' });

	function ss(m, e) {
		stEl.textContent = m;
		stEl.style.display = m ? '' : 'none';
		if (e) {
			stEl.style.color = '#b91c1c';
			stEl.style.background = '#fef2f2';
			stEl.style.borderColor = '#fecaca';
		} else {
			stEl.style.color = '#475569';
			stEl.style.background = '#f8fafc';
			stEl.style.borderColor = '#e2e8f0';
		}
	}

	if (map)
		delete map._frpcRestoreInlineStatus;
	if (restoreInlineStatus === 'reloaded')
		ss(_('Configuration restored successfully, FRPC has been reloaded.'));
	else if (restoreInlineStatus === 'stopped')
		ss(_('Configuration restored successfully, FRPC is currently not running.'));
	else if (restoreInlineStatus === 'unknown')
		ss(_('Configuration restored successfully, FRPC running state is unknown.'));
	else if (restoreInlineStatus === 'reload_failed')
		ss(_('Configuration restored successfully, but FRPC reload failed.'), true);

	function updateImportButtonState() {
		try {
			const btn = document.getElementById('frp-import-btn');
			if (btn)
				btn.disabled = importInProgress || validationInProgress || !selectedBackupFile ||
					!validatedBackupData || !backendValidationResult || backendValidationResult.ok !== true ||
					importValidationError !== null;
		} catch (e) {}
	}

	fi.addEventListener('change', function(ev) {
		const file = ev.target.files && ev.target.files[0];
		selectedBackupFile = null;
		validatedBackupData = null;
		importValidationError = null;
		backendValidationResult = null;
		validationInProgress = false;

		if (!file) { ss(_('No backup file selected.')); updateImportButtonState(); return; }
		if (!file.name.endsWith('.json')) { ss(_('Please select a .json backup file.'), true); updateImportButtonState(); return; }
		if (!file.size || file.size < 2) { ss(_('File is empty or too small.'), true); updateImportButtonState(); return; }
		if (file.size > 262144) {
			ss(_('File too large, max 256 KiB.') + ' (' + (file.size / 1024).toFixed(1) + ' KB)', true);
			updateImportButtonState();
			return;
		}

		selectedBackupFile = file;
		ss(_('Reading and validating backup file...'));
		const reader = new FileReader();
		reader.onload = function(e) {
			try {
				const parsed = JSON.parse(e.target.result);
				validateImportBackup(parsed);
				validatedBackupData = parsed;
				importValidationError = null;
				backendValidationResult = null;
				validationInProgress = true;
				updateImportButtonState();
				ss(_('Validating backup on router\u2026'), false);

				callValidateBackup(JSON.stringify(parsed)).then(function(result) {
					if (result && result.ok === true) {
						backendValidationResult = result;
						importValidationError = null;
						validationInProgress = false;
						const d = result.diff || {};
						const added = (d.added_section_count || 0) + (d.added_option_count || 0);
						const changed = d.changed_option_count || 0;
						const removed = (d.removed_section_count || 0) + (d.removed_option_count || 0);
						ss(_('Backup validation passed.') + ' ' + _('Options') + ': ' + (result.option_count || 0) +
							', ' + _('Added') + ': ' + added + ', ' + _('Changed') + ': ' + changed + ', ' + _('Removed') + ': ' + removed);
					} else {
						backendValidationResult = null;
						validationInProgress = false;
						importValidationError = (result && result.message) || _('Backend validation failed');
						ss(_('Backup validation failed: ') + importValidationError, true);
					}
					updateImportButtonState();
				}).catch(function(err) {
					backendValidationResult = null;
					validationInProgress = false;
					importValidationError = (err && err.message) ? err.message : String(err);
					ss(_('Unable to validate backup on router: ') + importValidationError, true);
					updateImportButtonState();
				});
			} catch (e2) {
				selectedBackupFile = null;
				validatedBackupData = null;
				backendValidationResult = null;
				validationInProgress = false;
				importValidationError = e2.message || 'Unknown error';
				ss(_('Backup validation failed: ') + importValidationError, true);
				updateImportButtonState();
			}
		};
		reader.onerror = function() {
			selectedBackupFile = null;
			validatedBackupData = null;
			importValidationError = 'File read error';
			ss(_('Failed to read backup file.'), true);
			updateImportButtonState();
		};
		reader.readAsText(file);
	});

	function setExportStatus(message, isError) {
		expStatusEl.textContent = message || '';
		expStatusEl.style.display = message ? 'block' : 'none';
		expStatusEl.style.color = isError ? '#b91c1c' : '#166534';
		expStatusEl.style.background = isError ? '#fef2f2' : '#f0fdf4';
		expStatusEl.style.borderColor = isError ? '#fecaca' : '#bbf7d0';
	}

	function handleExport() {
		readCurrentSections().then(function(sections) {
			const backup = buildBackupPayload(sections);
			const optCount = countBackupOptions(backup);
			const doExport = function() {
				const n = new Date();
				const ts = n.getFullYear() + ('0' + (n.getMonth() + 1)).slice(-2) +
					('0' + n.getDate()).slice(-2) + '-' + ('0' + n.getHours()).slice(-2) +
					('0' + n.getMinutes()).slice(-2) + ('0' + n.getSeconds()).slice(-2);
				const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' });
				const anchor = document.createElement('a');
				anchor.href = URL.createObjectURL(blob);
				anchor.download = 'frpc-advanced-backup-' + ts + '.json';
				document.body.appendChild(anchor);
				anchor.click();
				document.body.removeChild(anchor);
				URL.revokeObjectURL(anchor.href);
				setExportStatus(_('Backup exported successfully.'), false);
			};
			const msg = _('Important: The backup file contains tokens, passwords, and other sensitive information. Keep it secure.') +
				'\n\n' + _('This backup will contain %s configuration options.').replace('%s', optCount);
			ui.showModal(_('Export Configuration'), [
				E('p', { style: 'white-space:pre-line;max-width:460px' }, msg),
				E('div', { style: 'display:flex;gap:8px;margin-top:12px;justify-content:flex-end' }, [
					E('button', { class: 'cbi-button cbi-button-neutral', click: ui.hideModal }, _('Cancel')),
					E('button', {
						class: 'cbi-button cbi-button-apply',
						click: function(ev) { ev.currentTarget.disabled = true; ui.hideModal(); doExport(); }
					}, _('Confirm Export'))
				])
			]);
		}).catch(function(e) { setExportStatus(_('Export failed: ') + (e.message || e), true); });
	}

	function handleImport() {
		if (!validatedBackupData || !selectedBackupFile) {
			ss(_('No validated backup data available.'), true);
			return;
		}
		importInProgress = true;
		updateImportButtonState();
		ss(_('Importing...'));
		callRestoreConfig(JSON.stringify(validatedBackupData)).then(function(result) {
			let restoreStatus = null;
			if (!result || result.ok !== true) {
				if (result && result.code === 'SERVICE_RESTART_FAILED' && result.config_restored === true) {
					restoreStatus = 'reload_failed';
				} else {
					const code = result && result.code ? ' [' + result.code + ']' : '';
					const stage = result && result.stage ? ' [' + result.stage + ']' : '';
					const msg = result && (result.message || result.err) ? (result.message || result.err) : 'Import failed';
					throw new Error(msg + code + stage);
				}
			} else if (result.service_state === 'running' && result.runtime_synchronized === true) {
				restoreStatus = 'reloaded';
			} else if (result.service_state === 'stopped') {
				restoreStatus = 'stopped';
			} else {
				restoreStatus = 'unknown';
			}
			selectedBackupFile = null;
			validatedBackupData = null;
			backendValidationResult = null;
			importValidationError = null;
			importInProgress = false;
			map._frpcRestoreInlineStatus = restoreStatus;
			map.data.unload(map.config);
			return map.render().then(function() {
				if (typeof (map._frpcPostProcess) === 'function')
					map._frpcPostProcess();
			});
		}).catch(function(e) {
			const detail = e && e.message ? e.message : String(e);
			ss(_('Import failed: ') + detail, true);
		}).then(function() {
			importInProgress = false;
			updateImportButtonState();
		});
	}

	const expStatusEl = E('div', { style: 'display:none;margin-top:8px;padding:8px 10px;border-radius:4px;font-size:13px;line-height:1.5;border:1px solid #e2e8f0;word-break:break-word' });

	return E('div', { style: 'width:100%;max-width:940px;margin-left:0;margin-right:auto;font-size:.92rem;line-height:1.5' }, [
		E('h4', { style: 'margin:0 0 4px;font-size:1.05rem;font-weight:600' }, _('Configuration Backup & Restore')),
		E('p', { style: 'margin:0 0 10px;opacity:.78;font-size:.85rem' }, _('Back up the current saved configuration or restore it from a backup file.')),
		E('style', {}, '@media(max-width:900px){.frp-panel-grid{grid-template-columns:1fr!important}.frp-panel-right{border-left:0!important;border-top:1px solid #d1d5db!important}}'),
		E('div', { style: 'display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:stretch;border:1px solid #d1d5db;border-radius:8px;overflow:hidden', class: 'frp-panel-grid' }, [
			E('div', { style: 'padding:16px;display:flex;flex-direction:column' }, [
				E('div', { style: 'font-weight:600;font-size:.98rem;margin:0 0 2px' }, _('Export Configuration')),
				E('div', { style: 'font-size:.82rem;opacity:.72;margin:0 0 10px' }, _('Export the current saved FRPC configuration as a JSON backup file.')),
				E('div', { style: 'font-size:.82rem;opacity:.75;margin:0 0 10px;line-height:1.45' }, [
					E('strong', {}, _('Backup source') + ': '),
					_('Current saved FRP configuration')
				]),
				E('div', { style: 'margin-top:auto;padding-top:12px' }, [
					E('button', { class: 'cbi-button cbi-button-action', click: handleExport }, _('Export Configuration')),
					expStatusEl
				])
			]),
			E('div', { style: 'padding:16px;border-left:1px solid #d1d5db;display:flex;flex-direction:column', class: 'frp-panel-right' }, [
				E('div', { style: 'font-weight:600;font-size:.98rem;margin:0 0 2px' }, _('Import & Restore')),
				E('div', { style: 'font-size:.82rem;opacity:.72;margin:0 0 10px' }, _('Select a backup file. The router will validate it before restoring the configuration.')),
				E('div', { style: 'display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:0 0 8px' }, [
					fi,
					E('button', { type: 'button', class: 'cbi-button', click: function() { fi.click(); } }, _('Select Backup File'))
				]),
				stEl,
				E('div', { style: 'margin-top:auto;padding-top:12px' }, [
					E('button', { class: 'cbi-button cbi-button-reset', id: 'frp-import-btn', disabled: true, click: handleImport }, _('Import & Restore'))
				])
			])
		]),
		E('div', { style: 'border:1px solid #d1d5db;border-top:0;border-radius:0 0 8px 8px;padding:10px 16px;font-size:.78rem;opacity:.7;line-height:1.45' }, HELP_TIP)
	]);
}

/* ---- FRPS server advanced modal: grouped two-column layout ---- */
function layoutServerModal(grid, sectionId) {
	const modalMap = grid.getActiveModalMap();
	if (!modalMap)
		return;

	/* The modal for a GridSection is a NamedSection whose DOM id is
	 * "cbi-<config>.<section-id>" on this LuCI version (not a fixed id), so
	 * resolve the section node dynamically from the active modal map instead
	 * of guessing a constant element id. */
	const sectionNode = modalMap.querySelector('.cbi-section');
	if (!sectionNode)
		return;

	/* Cap the desktop modal width (default cbi-modal is 900px). */
	const modal = sectionNode.closest('.modal');
	if (modal)
		modal.style.maxWidth = '920px';

	/* Advanced tab pane is a direct child of the tabbed section node. */
	const adv = sectionNode.querySelector('.cbi-section-node-tabbed > [data-tab="advanced"]');
	if (!adv)
		return;

	const rows = {};
	const allFields = [
		'auth__additionalScopes',
		'transport__tls__enable',
		'transport__tls__disableCustomTLSFirstByte',
		'transport__tls__certFile',
		'transport__tls__keyFile',
		'transport__tls__trustedCaFile',
		'transport__tls__serverName',
		'transport__tcpMux',
		'transport__tcpMuxKeepaliveInterval',
		'auth__oidc__scope',
		'auth__oidc__trustedCaFile',
		'auth__oidc__proxyURL',
		'auth__oidc__insecureSkipVerify'
	];
	for (const name of allFields) {
		const row = adv.querySelector('[data-name="' + name + '"]');
		if (row)
			rows[name] = row;
	}

	adv.textContent = '';

	const FLAG_FIELDS = new Set([
		'transport__tls__enable',
		'transport__tls__disableCustomTLSFirstByte',
		'transport__tcpMux',
		'auth__oidc__insecureSkipVerify'
	]);

	function layoutFlagRow(row) {
		if (!row || row.querySelector('.frpc-flag-head'))
			return row;
		const header = E('div', { class: 'frpc-flag-head' });
		const title = row.querySelector('.cbi-value-title');
		const checkbox = row.querySelector('.cbi-value-field .cbi-checkbox');
		if (title && checkbox) {
			row.insertBefore(header, row.firstChild);
			checkbox.parentNode.removeChild(checkbox);
			header.appendChild(checkbox);
			row.removeChild(title);
			header.appendChild(title);
		}
		return row;
	}

	function takeRow(name) {
		const row = rows[name];
		if (row && FLAG_FIELDS.has(name)) {
			row.classList.add('frpc-flag-row');
			layoutFlagRow(row);
		}
		return row;
	}

	function groupTitle(title, iconClass) {
		return E('h4', { class: 'frpc-adv-group-title' }, [
			E('span', { class: 'frpc-group-icon ' + iconClass }),
			E('span', { class: 'frpc-group-title-text' }, title)
		]);
	}

	function arrow() {
		return E('span', { class: 'frpc-trigger-arrow' });
	}

	/* Four groups are direct grid children of .frpc-adv-main (2x2). */
	const authGroup = E('div', { class: 'frpc-adv-auth' });
	authGroup.appendChild(groupTitle(_('Authentication'), 'frpc-group-icon-auth'));
	const authRow = takeRow('auth__additionalScopes');
	if (authRow)
		authGroup.appendChild(authRow);

	const connGroup = E('div', { class: 'frpc-adv-conn' });
	connGroup.appendChild(groupTitle(_('Connection Optimization'), 'frpc-group-icon-connection'));
	for (const name of [ 'transport__tcpMux', 'transport__tcpMuxKeepaliveInterval' ]) {
		const row = takeRow(name);
		if (row)
			connGroup.appendChild(row);
	}

	/* TLS group (grid cell row 2, column 1). TLS details live inside this group. */
	const tlsGroup = E('div', { class: 'frpc-adv-tls' });
	tlsGroup.appendChild(groupTitle(_('TLS'), 'frpc-group-icon-tls'));
	for (const name of [ 'transport__tls__enable', 'transport__tls__disableCustomTLSFirstByte' ]) {
		const row = takeRow(name);
		if (row)
			tlsGroup.appendChild(row);
	}

	/* TLS detail fields behind a lightweight text trigger. */
	const tlsDetailFields = [
		'transport__tls__certFile',
		'transport__tls__keyFile',
		'transport__tls__trustedCaFile',
		'transport__tls__serverName'
	];
	const tlsDetails = E('div', { class: 'frpc-tls-details', hidden: true });
	let anyTlsFile = false;
	for (const name of tlsDetailFields) {
		const row = takeRow(name);
		if (row)
			tlsDetails.appendChild(row);
		if (hasFormValue(grid.map.data.get('frpc-advanced', sectionId, name)))
			anyTlsFile = true;
	}
	const tlsTrigger = E('button', { class: 'frpc-tls-trigger', type: 'button', click: toggleTls }, [
		E('span', {}, _('展开 TLS 详细选项')),
		arrow()
	]);
	function toggleTls(force) {
		const open = (typeof force === 'boolean') ? force : tlsDetails.hidden;
		tlsDetails.hidden = !open;
		tlsTrigger.classList.toggle('frpc-open', open);
	}
	tlsGroup.appendChild(tlsTrigger);
	tlsGroup.appendChild(tlsDetails);
	toggleTls(anyTlsFile);

	/* OIDC Advanced Settings group (grid cell row 2, column 2). */
	const oidcGroup = E('div', { class: 'frpc-oidc-group' });
	oidcGroup.appendChild(groupTitle(_('OIDC Advanced Settings'), 'frpc-group-icon-oidc'));
	for (const name of [
		'auth__oidc__scope',
		'auth__oidc__trustedCaFile',
		'auth__oidc__proxyURL',
		'auth__oidc__insecureSkipVerify'
	]) {
		const row = takeRow(name);
		if (row)
			oidcGroup.appendChild(row);
	}

	const leftColumn = E('div', { class: 'frpc-adv-column frpc-adv-column-left' }, [ authGroup, tlsGroup ]);
	const rightColumn = E('div', { class: 'frpc-adv-column frpc-adv-column-right' }, [ connGroup, oidcGroup ]);
	adv.appendChild(E('div', { class: 'frpc-adv-main' }, [ leftColumn, rightColumn ]));

	/* OIDC group only shows when auth method is OIDC. Connection Optimization stays put. */
	const methodSelect = sectionNode.querySelector('[data-name="auth__method"] select');
	function syncOidc() {
		const on = methodSelect && methodSelect.value === 'oidc';
		oidcGroup.classList.toggle('frpc-hidden', !on);
	}
	if (methodSelect)
		methodSelect.addEventListener('change', syncOidc);
	syncOidc();
}


/* ---- FRPS rule advanced modal: grouped 2x2 layout ---- */
function layoutRuleFlagRow(row) {
	if (!row || row.querySelector('.frpc-rule-flag-head'))
		return row;
	const header = E('div', { class: 'frpc-rule-flag-head' });
	const title = row.querySelector('.cbi-value-title');
	const checkbox = row.querySelector('.cbi-value-field .cbi-checkbox');
	if (title && checkbox) {
		row.insertBefore(header, row.firstChild);
		checkbox.parentNode.removeChild(checkbox);
		header.appendChild(checkbox);
		row.removeChild(title);
		header.appendChild(title);
	}
	return row;
}

function layoutRuleModal(grid, sectionId) {
	const modalMap = grid.getActiveModalMap();
	if (!modalMap)
		return;

	const sectionNode = modalMap.querySelector('.cbi-section');
	if (!sectionNode)
		return;

	const modal = sectionNode.closest('.modal');
	if (modal)
		modal.style.maxWidth = '960px';

	const adv = sectionNode.querySelector('.cbi-section-node-tabbed > [data-tab="advanced"]');
	if (!adv)
		return;

	const FLAG_FIELDS = new Set([
		'visitor',
		'keepTunnelOpen',
		'natTraversal__disableAssistedAddrs',
		'transport__useEncryption',
		'transport__useCompression',
		'enableHTTP2'
	]);

	const groupOrder = [
		['access', 'visitor'],
		['access', 'allowUsers'],
		['access', 'protocol'],
		['access', 'maxRetriesAnHour'],
		['access', 'minRetryInterval'],
		['access', 'fallbackTo'],
		['access', 'fallbackTimeoutMs'],
		['access', 'keepTunnelOpen'],
		['access', 'natTraversal__disableAssistedAddrs'],
		['access', 'locations'],
		['access', 'hostHeaderRewrite'],
		['access', 'httpUser'],
		['access', 'httpPassword'],
		['access', 'routeByHTTPUser'],
		['transport', 'transport__bandwidthLimit'],
		['transport', 'transport__bandwidthLimitMode'],
		['transport', 'transport__useEncryption'],
		['transport', 'transport__useCompression'],
		['transport', 'transport__proxyProtocolVersion'],
		['health', 'loadBalancer__group'],
		['health', 'loadBalancer__groupKey'],
		['health', 'healthCheck__type'],
		['health', 'healthCheck__path'],
		['health', 'healthCheck__timeoutSeconds'],
		['health', 'healthCheck__maxFailed'],
		['health', 'healthCheck__intervalSeconds'],
		['extension', 'PlUgIn_type'],
		['extension', 'unixPath'],
		['extension', 'username'],
		['extension', 'password'],
		['extension', 'localPath'],
		['extension', 'stripPrefix'],
		['extension', 'PlUgIn_httpUser'],
		['extension', 'PlUgIn_httpPassword'],
		['extension', 'localAddr'],
		['extension', 'crtPath'],
		['extension', 'keyPath'],
		['extension', 'PlUgIn_hostHeaderRewrite'],
		['extension', 'enableHTTP2'],
		['extension', 'extra_options'],
		['extension', 'extra_options_plugin']
	];

	const rows = {};
	for (const pair of groupOrder) {
		const row = adv.querySelector('[data-name="' + pair[1] + '"]');
		if (row)
			rows[pair[1]] = { group: pair[0], row: row };
	}

	adv.textContent = '';

	function takeRow(name) {
		const entry = rows[name];
		if (!entry)
			return null;
		if (FLAG_FIELDS.has(name))
			entry.row.classList.add('frpc-rule-flag-row');
		return entry.row;
	}

	function groupTitle(title, iconClass) {
		return E('h4', { class: 'frpc-rule-group-title' }, [
			E('span', { class: 'frpc-rule-group-icon ' + iconClass }),
			E('span', { class: 'frpc-rule-group-title-text' }, title)
		]);
	}

	const groups = {
		access: E('div', { id: 'frpc-rule-access-' + sectionId, class: 'frpc-rule-group-access' }),
		transport: E('div', { id: 'frpc-rule-transport-' + sectionId, class: 'frpc-rule-group-transport' }),
		health: E('div', { id: 'frpc-rule-health-' + sectionId, class: 'frpc-rule-group-health' }),
		extension: E('div', { id: 'frpc-rule-extension-' + sectionId, class: 'frpc-rule-group-extension' })
	};

	groups.access.appendChild(groupTitle(_('Access & Protocol'), 'frpc-rule-group-icon-access'));
	groups.transport.appendChild(groupTitle(_('Transport & Traffic'), 'frpc-rule-group-icon-transport'));
	groups.health.appendChild(groupTitle(_('Load Balancing & Health Check'), 'frpc-rule-group-icon-health'));
	groups.extension.appendChild(groupTitle(_('Plugins & Extensions'), 'frpc-rule-group-icon-extension'));

	function rebindDependencyParent(row, parent) {
		if (!row || !parent || !row.id || !Array.isArray(window.cbi_d))
			return;

		for (let i = 0; i < window.cbi_d.length; i++) {
			const entry = window.cbi_d[i];

			if (entry && entry.id === row.id)
				entry.parent = parent.id;
		}
	}

	for (const pair of groupOrder) {
		const row = takeRow(pair[1]);
		if (row) {
			const group = groups[pair[0]];
			group.appendChild(row);
			rebindDependencyParent(row, group);
		}
	}

	/* Rule flags: move native checkbox next to the title (idempotent, no clone). */
	for (const name of FLAG_FIELDS) {
		const entry = rows[name];
		if (entry)
			layoutRuleFlagRow(entry.row);
	}

	const leftColumn = E('div', { class: 'frpc-rule-column frpc-rule-column-left' }, [ groups.access, groups.health ]);
	const rightColumn = E('div', { class: 'frpc-rule-column frpc-rule-column-right' }, [ groups.transport, groups.extension ]);
	adv.appendChild(E('div', { class: 'frpc-rule-advanced-layout' }, [ leftColumn, rightColumn ]));

	/* Re-run LuCI's native dependency update after all rows were re-parented. */
	if (typeof window.cbi_d_update === 'function')
		window.cbi_d_update();

	/* Hide a group completely when dependency filtering leaves it with no visible rows. */
	function syncRuleGroupVisibility() {
		for (const key of Object.keys(groups)) {
			const group = groups[key];
			const visible = Array.from(group.querySelectorAll('.cbi-value')).some(function(row) {
				return !row.classList.contains('hidden');
			});
			group.classList.toggle('frpc-rule-group-empty', !visible);
		}
	}

	syncRuleGroupVisibility();
	const ruleGroupObserver = new MutationObserver(function() {
		requestAnimationFrame(syncRuleGroupVisibility);
	});
	for (const key of Object.keys(groups)) {
		ruleGroupObserver.observe(groups[key], {
			subtree: true,
			childList: true,
			attributes: true,
			attributeFilter: [ 'class' ]
		});
	}
}


return view.extend({
	load() {
		return Promise.all([
			uci.load('frpc-advanced'),
			L.resolveDefault(callGetStatus(), { ok: false, running: false, instances: [] })
		]);
	},

	render(data) {
		addStyleOnce();
		const initialStatus = normalizeServiceStatus(data[1] || {});
		const m = new form.Map('frpc-advanced');
		const pageDescription = E('p', { class: 'cbi-map-descr frpc-page-description' }, [
			_('FRP is a high-performance reverse proxy application for exposing private services.'),
			' ', E('a', { href: 'https://github.com/fatedier/frp', target: '_blank', rel: 'noreferrer' }, 'GitHub'),
			' ', E('a', { href: 'https://gofrp.org/zh-cn/', target: '_blank', rel: 'noreferrer' }, _('Documentation'))
		]);
		function renderStatusPanel() {
			poll.add(function() {
				return L.resolveDefault(getServiceStatus()).then(function(status) {
					const view = document.getElementById('frpc_service_status');
					if (view) view.innerHTML = renderStatus(status);
				});
			});
			const statusLine = E('p', { id: 'frpc_service_status' });
			statusLine.innerHTML = renderStatus(initialStatus);
			return E('div', { class: 'frpc-status-panel' },
				E('fieldset', { class: 'cbi-section' }, [statusLine]));
		}
		const statusPanel = renderStatusPanel();
		let currentMode = localStorage.getItem('frpc-advanced-display-mode') === 'advanced' ? 'advanced' : 'basic';

		function applyUiMode(content, mode) {
			content.classList.toggle('frpc-ui-basic', mode === 'basic');
		}

		function setUiMode(mode) {
			localStorage.setItem('frpc-advanced-display-mode', mode);
			currentMode = mode;
			const root = document.querySelector('.frpc-advanced-root');
			if (!root) return;
			applyUiMode(root, mode);
			const buttons = root.querySelectorAll('.frpc-mode-buttons button.cbi-button');
			if (buttons[0]) {
				buttons[0].classList.toggle('cbi-button-action', mode === 'basic');
				buttons[0].classList.toggle('cbi-button-neutral', mode !== 'basic');
			}
			if (buttons[1]) {
				buttons[1].classList.toggle('cbi-button-action', mode === 'advanced');
				buttons[1].classList.toggle('cbi-button-neutral', mode !== 'advanced');
			}
			const desc = root.querySelector('.frpc-mode-desc');
			if (desc) desc.textContent = mode === 'basic' ? _('Show common settings only') : _('Show all settings');
		}

		function renderModeSelector() {
			return E('div', { class: 'frpc-mode-bar' }, [
				E('span', { class: 'frpc-mode-title' }, _('Display mode')),
				E('div', { class: 'frpc-mode-buttons' }, [
					E('button', {
						class: 'cbi-button ' + (currentMode === 'basic' ? 'cbi-button-action' : 'cbi-button-neutral'),
						type: 'button',
						click: function() { setUiMode('basic'); }
					}, _('Basic')),
					E('button', {
						class: 'cbi-button ' + (currentMode === 'advanced' ? 'cbi-button-action' : 'cbi-button-neutral'),
						type: 'button',
						click: function() { setUiMode('advanced'); }
					}, _('Advanced'))
				]),
				E('span', { class: 'frpc-mode-desc' },
					currentMode === 'basic' ? _('Show common settings only') : _('Show all settings'))
			]);
		}

		let s = m.section(form.NamedSection, 'main', 'frpc');
		s.addremove = false;
		s.tab('general', _('Run & Log'));
		s.tab('transport', _('Transport & Limits'));
		s.tab('manage', _('Management Panel'));
		s.tab('extensions', _('Extension Features'));

		let o = setSwitch(s.taboption('general', form.Flag, 'enabled', _('Enable')), false);
		o = s.taboption('general', form.Value, 'client_file', _('Executable file path'), _('Path to the frpc binary.'));
		o.datatype = 'file';
		o.default = '/usr/bin/frpc';
		o.rmempty = false;

		o = withFieldHelp(s.taboption('general', widgets.UserSelect, 'run_user', _('Run daemon as user'), _('Default: root')));
		o.default = 'root';
		o.rmempty = false;
		setSwitch(s.taboption('general', form.Flag, 'respawn', _('Respawn when crashed')), true);

		o = s.taboption('general', form.ListValue, 'server', _('Current FRPS server'), _('Select the FRPS server configuration currently used by this FRPC Client.'));
		o.rmempty = true;
		o.optional = true;
		o.validate = function(sectionId, value) {
			const profiles = this.map.data.sections('frpc-advanced', 'server');
			if (profiles.length === 0)
				return true;
			if (!value || !profiles.some(function(profile) { return profile['.name'] === value; }))
				return _('Please select an FRPS server');
			return true;
		};
		const currentServerOption = o;

		/* Initial abstract option state (no DOM yet). */
		const serverProfiles = uci.sections('frpc-advanced', 'server');
		const selectedServer = uci.get('frpc-advanced', 'main', 'server');
		if (serverProfiles.length === 0) {
			o.value('', _('Please add an FRPS server first'));
			o.readonly = true;
		} else if (!selectedServer || !serverProfiles.some(function(s) { return s['.name'] === selectedServer; })) {
			o.map.data.set('frpc-advanced', 'main', 'server', serverProfiles[0]['.name']);
		}
		for (const s of serverProfiles) {
			const addr = '%s:%s'.format(s.serverAddr || '0.0.0.0', s.serverPort || '7000');
			o.value(s['.name'], s.alias ? '%s \u2014 %s'.format(s.alias, addr) : addr);
		}

		function serverProfileLabel(server) {
			const addr = '%s:%s'.format(server.serverAddr || '0.0.0.0', server.serverPort || '7000');
			return server.alias ? '%s \u2014 %s'.format(server.alias, addr) : addr;
		}

		/* SINGLE authoritative selector-sync: reads effective servers + main.server,
		 * rebuilds the DOM select, sets the selected value, and dispatches change LAST. */
		function syncServerSelector(createdSectionId, selectFirstServer) {
			const profiles = uci.sections('frpc-advanced', 'server');
			const authoritative = currentServerOption.map.data.get('frpc-advanced', 'main', 'server');

			let selected = '';
			if (selectFirstServer && createdSectionId) {
				selected = createdSectionId;
			} else if (authoritative && profiles.some(function(p) { return p['.name'] === authoritative; })) {
				selected = authoritative;
			} else if (profiles.length > 0) {
				selected = profiles[0]['.name'];
				currentServerOption.map.data.set('frpc-advanced', 'main', 'server', selected);
			}

			currentServerOption.keylist.length = 0;
			currentServerOption.vallist.length = 0;
			currentServerOption.readonly = profiles.length === 0;
			if (profiles.length === 0)
				currentServerOption.value('', _('Please add an FRPS server first'));
			for (const p of profiles)
				currentServerOption.value(p['.name'], serverProfileLabel(p));

			const frame = currentServerOption.map.findElement('id', currentServerOption.cbid('main'));
			const select = frame && (frame.matches('select') ? frame : frame.querySelector('select'));
			if (!select)
				return;
			select.innerHTML = '';
			if (profiles.length === 0) {
				select.appendChild(E('option', {
					value: '',
					disabled: ''
				}, _('Please add an FRPS server first')));
			}
			for (const p of profiles)
				select.appendChild(E('option', { value: p['.name'] }, serverProfileLabel(p)));
			select.disabled = profiles.length === 0;
			select.value = selected;
			select.dispatchEvent(new Event('change', { bubbles: true }));
		}
		o = s.taboption('general', form.Value, 'clientID', _('Client ID'), _('Optional stable identifier for this frpc instance.'));
		o = s.taboption('general', form.Value, 'user', _('User prefix'), _('Prefix applied to proxy names.'));
		o = frpcBoolDefaultTrue(s.taboption('general', form.Flag, 'loginFailExit', _('Exit on login failure'),
			_('FRP default: Enabled. Disable only when you need to keep retrying.')));

		o = s.taboption('general', form.ListValue, 'log__level', _('Log level'),
			_('Use info for daily use; debug/trace only for short-term troubleshooting.'));
		for (const level of ['trace', 'debug', 'info', 'warn', 'error'])
			o.value(level);
		o.default = 'info';

		o = s.taboption('transport', form.ListValue, 'transport__protocol', _('Transport protocol'),
			_('Underlying transport used for the FRPC to FRPS connection.'));
		for (const protocol of ['tcp', 'kcp', 'quic', 'websocket', 'wss'])
			o.value(protocol);

		o = s.taboption('transport', form.ListValue, 'transport__wireProtocol', _('FRP Wire Protocol'),
			_('Internal FRP message protocol between FRPC and FRPS. Leave empty to use the FRP default: v1.'));
		o.value('v1');
		o.value('v2');

		o = s.taboption('transport', form.Value, 'transport__poolCount', _('Connection pool count'));
		o.datatype = 'uinteger';
		o.placeholder = '1';

		o = s.taboption('transport', form.Value, 'transport__dialServerTimeout', _('Dial server timeout'), _('Unit: seconds.'));
		o.datatype = 'uinteger';
		o.placeholder = '10';

		o = s.taboption('transport', form.Value, 'transport__dialServerKeepalive', _('Dial server keepalive'),
		_('Unit: seconds. Use a negative value to disable keepalive probes.'));
		o.datatype = 'integer';
		o.placeholder = '7200';

		o = s.taboption('transport', form.Value, 'transport__connectServerLocalIP', _('Connect server local IP'));
		o.datatype = 'host';
		o.depends('transport__protocol', 'tcp');
		o.depends('transport__protocol', 'websocket');
		o.depends('transport__protocol', '');

		o = s.taboption('transport', form.Value, 'transport__proxyURL', _('Proxy address'),
		_('Connect to FRPS through an HTTP, SOCKS5, SOCKS5H, or NTLM proxy.'));
		o.depends('transport__protocol', 'tcp');
		o.depends('transport__protocol', '');

		o = s.taboption('transport', form.Value, 'transport__quic__keepalivePeriod', _('QUIC keepalive period'));
		o.datatype = 'integer';
		o.placeholder = '10';
		o.depends('transport__protocol', 'quic');

		o = s.taboption('transport', form.Value, 'transport__quic__maxIdleTimeout', _('QUIC max idle timeout'));
		o.datatype = 'integer';
		o.placeholder = '30';
		o.depends('transport__protocol', 'quic');

		o = s.taboption('transport', form.Value, 'transport__quic__maxIncomingStreams', _('QUIC max incoming streams'));
		o.datatype = 'uinteger';
		o.placeholder = '100000';
		o.depends('transport__protocol', 'quic');

		o = s.taboption('transport', form.Value, 'transport__heartbeatInterval', _('Heartbeat interval'),
		_('Seconds. A negative value disables application-layer heartbeats.'));
		o.datatype = 'integer';
		o.placeholder = '-1';
		o = s.taboption('transport', form.Value, 'transport__heartbeatTimeout', _('Heartbeat timeout'));
		o.datatype = 'integer';
		o.placeholder = '-1';

		o = s.taboption('transport', form.Value, 'dnsServer', _('DNS server'));
		o.datatype = 'host';
		o = s.taboption('transport', form.Value, 'natHoleStunServer', _('STUN server'), _('Used for XTCP NAT traversal.'));
		o.placeholder = 'stun.easyvoip.com:3478';
		o = s.taboption('transport', form.Value, 'udpPacketSize', _('UDP packet size'));
		o.datatype = 'uinteger';
		o.placeholder = '1500';
		o = s.taboption('extensions', form.DynamicList, 'includes', _('Additional proxy configurations'),
			_('TOML files or glob patterns. Included files may define only proxies and visitors.'));
		o.placeholder = '/etc/frp/frpc.d/*.toml';
		o = s.taboption('extensions', form.DynamicList, 'com_extra_options', _('Extra TOML options'),
		_('Advanced raw TOML lines appended to the common configuration. Invalid syntax prevents startup.'));
		o.placeholder = 'option = value';

		o = withFieldHelp(s.taboption('manage', form.Value, 'webServer__addr', _('Management panel address'), _('Default is 127.0.0.1. Set to 0.0.0.0 to listen on all network interfaces.')));
		o.datatype = 'host';
		o.placeholder = '127.0.0.1';
		o = s.taboption('manage', form.Value, 'webServer__port', _('Admin port'));
		o.datatype = 'port';
		o = s.taboption('manage', form.Value, 'webServer__user', _('Admin user'));
		o = s.taboption('manage', form.Value, 'webServer__password', _('Admin password'));
		o.password = true;
		o = s.taboption('manage', form.Value, 'webServer__assetsDir', _('Admin assets directory'));
		o = s.taboption('manage', form.Value, 'webServer__tls__certFile', _('Admin panel TLS certificate'));
		o.datatype = 'file';
		o = s.taboption('manage', form.Value, 'webServer__tls__keyFile', _('Admin panel TLS private key'));
		o.datatype = 'file';
		frpcBoolDefaultFalse(s.taboption('manage', form.Flag, 'webServer__pprofEnable', _('Enable pprof'), _('FRP default: Disabled. Enable only for troubleshooting.')));
		o = s.taboption('manage', form.Value, 'store__path', _('Built-in Store file'),
			_('Persists proxies and visitors managed through the FRPC web API.'));
		o.placeholder = '/etc/frp/frpc-store.json';

	o = s.taboption("extensions", form.DummyValue, "_backup_restore", _("Configuration Backup && Restore"));
	o.description = _("Export or restore FRP configuration. Local executable and service settings are preserved. Only accepts JSON backups exported by this plugin.");
	o.cfgvalue = function() { return ""; };
	o.render = function() { return buildBackupRestoreWidget(m); };


		for (const option of s.children) {
			if (option.option && option.option !== '_backup_restore' && !BASIC_FIELDS.has(option.option))
				markAdvancedOption(option);
		}

		// FRPS server profiles
		s = m.section(form.GridSection, 'server', _('FRPS Server Configurations'));
		s.anonymous = true;
		s.addremove = true;
		s.sortable = true;
		s.addbtntitle = _('Add FRPS Server');
		s.tab('basic', _('Basic Settings'));
		s.tab('advanced', _('Advanced Settings'));
		const serverGrid = s;
		s.sectiontitle = function(sectionId) {
			const section = this.map.data.get('frpc-advanced', sectionId);
			return section && section.alias || '—';
		};
		s.modaltitle = function(sectionId) {
			const section = this.map.data.get('frpc-advanced', sectionId);
			if (!section || (!section.alias && !section.serverAddr && !section.serverPort))
				return _('Add FRPS Server');
			const name = section.alias || '%s:%s'.format(section.serverAddr || '0.0.0.0', section.serverPort || '7000');
			return '%s - %s'.format(_('FRPS Server'), name);
		};

		o = setSwitch(s.taboption('basic', form.Flag, 'enabled', _('Enable')), true);
		o.modalonly = true;

		o = s.taboption('basic', form.Value, 'alias', _('Server Name'),
			_('Used to distinguish multiple FRPS servers.'));
		o.modalonly = true;

		o = s.option(form.DummyValue, '_server_address', _('Address'));
		o.modalonly = false;
		o.cfgvalue = function(sectionId) {
			return '%s:%s'.format(
				this.map.data.get('frpc-advanced', sectionId, 'serverAddr') || '0.0.0.0',
				this.map.data.get('frpc-advanced', sectionId, 'serverPort') || '7000');
		};

		o = s.taboption('basic', form.Value, 'serverAddr', _('Server address'), _('Address or domain name. IPv6 is supported.'));
		o.rmempty = false;
		o.datatype = 'host';
		o.default = '0.0.0.0';
		o.placeholder = '0.0.0.0';
		o.modalonly = true;
		o = s.taboption('basic', form.Value, 'serverPort', _('Server port'));
		o.datatype = 'port';
		o.placeholder = '7000';
		o.modalonly = true;

		o = withFieldHelp(s.taboption('basic', form.ListValue, 'auth__method', _('Authentication Method')));
		o.value('token', 'Token');
		o.value('oidc', _('OIDC'));
		o.modalonly = true;

		o = s.taboption('basic', form.Value, 'auth__token', _('Authentication token'));
		o.password = true;
		o.depends('auth__method', 'token');
		o.depends('auth__method', '');
		o.modalonly = true;
		o = withFieldHelp(s.taboption('basic', form.Value, 'auth__tokenSource__file__path', _('Read token from file')));
		o.datatype = 'file';
		o.depends('auth__method', 'token');
		o.depends('auth__method', '');
		o.modalonly = true;
		o.write = function(sectionId, value) {
			this.map.data.set('frpc-advanced', sectionId, this.option, value);
			this.map.data.set('frpc-advanced', sectionId, 'auth__tokenSource__type', 'file');
		};
		o.remove = function(sectionId) {
			this.map.data.unset('frpc-advanced', sectionId, this.option);
			this.map.data.unset('frpc-advanced', sectionId, 'auth__tokenSource__type');
		};

		o = withFieldHelp(s.taboption('advanced', form.MultiValue, 'auth__additionalScopes', _('Additional auth scopes'),
			_('Optional. Additional authentication scopes are disabled by default.')));
		o.value('HeartBeats');
		o.value('NewWorkConns');
		o.rmempty = true;
		o.modalonly = true;

		const oidcBasicFields = [
			['auth__oidc__clientID', _('OIDC client ID'), false, true],
			['auth__oidc__clientSecret', _('OIDC client secret'), true, false],
			['auth__oidc__audience', _('OIDC audience'), false, false],
			['auth__oidc__tokenEndpointURL', _('OIDC token endpoint URL'), false, true]
		];
		for (const field of oidcBasicFields) {
			o = withFieldHelp(s.taboption('basic', form.Value, field[0], field[1]));
			o.depends('auth__method', 'oidc');
			o.modalonly = true;
			if (field[2]) o.password = true;
			if (field[3]) {
				o.optional = true;
				o.validate = function(sectionId, value) {
					if (!this.map.isDependencySatisfied(this.deps, this.config, sectionId))
						return true;
					if (!isServerRequiredArmed(sectionId))
						return true;
					if (value == null || String(value).trim() === '')
						return _('This field is required when OIDC authentication is selected.');
					return true;
				};
			}
		}

		const oidcAdvancedFields = [
			['auth__oidc__scope', _('OIDC scope')],
			['auth__oidc__trustedCaFile', _('OIDC trusted CA file'), false, false],
			['auth__oidc__proxyURL', _('OIDC proxy URL'), false, false]
		];
		for (const field of oidcAdvancedFields) {
			o = withFieldHelp(s.taboption('advanced', form.Value, field[0], field[1]));
			o.depends('auth__method', 'oidc');
			o.modalonly = true;
		}
		o = frpcBoolDefaultFalse(s.taboption('advanced', form.Flag, 'auth__oidc__insecureSkipVerify', _('OIDC insecure skip verify'),
			_('Insecure. Use only for debugging. FRP default: Disabled.')));
		o.depends('auth__method', 'oidc');
		o.modalonly = true;

		o = frpcBoolDefaultTrue(s.taboption('advanced', form.Flag, 'transport__tls__enable', _('Enable TLS'),
			_('FRP default: Enabled. Disable only when your server does not support TLS.')));
		o.modalonly = true;
		o = frpcBoolDefaultTrue(s.taboption('advanced', form.Flag, 'transport__tls__disableCustomTLSFirstByte', _('Disable custom TLS first byte'),
			_('FRP default: Enabled. Disable only for compatibility with older proxies.')));
		o.depends('transport__tls__enable', 'true');
		o.depends('transport__tls__enable', '');
		o.modalonly = true;
		o = withFieldHelp(s.taboption('advanced', form.Value, 'transport__tls__certFile', _('TLS client certificate path')));
		o.datatype = 'file';
		o.depends('transport__tls__enable', 'true');
		o.depends('transport__tls__enable', '');
		o.modalonly = true;
		o = s.taboption('advanced', form.Value, 'transport__tls__keyFile', _('TLS client key file path'));
		o.datatype = 'file';
		o.depends('transport__tls__enable', 'true');
		o.depends('transport__tls__enable', '');
		o.modalonly = true;
		o = s.taboption('advanced', form.Value, 'transport__tls__trustedCaFile', _('TLS CA certificate path'));
		o.datatype = 'file';
		o.depends('transport__tls__enable', 'true');
		o.depends('transport__tls__enable', '');
		o.modalonly = true;
		o = s.taboption('advanced', form.Value, 'transport__tls__serverName', _('TLS server name'));
		o.depends('transport__tls__enable', 'true');
		o.depends('transport__tls__enable', '');
		o.modalonly = true;

		o = frpcBoolDefaultTrue(s.taboption('advanced', form.Flag, 'transport__tcpMux', _('TCP multiplexing'),
			_('FRP default: Enabled. Disable only for low-resource environments.')));
		o.modalonly = true;
		o = s.taboption('advanced', form.Value, 'transport__tcpMuxKeepaliveInterval', _('TCP mux keepalive interval'));
		o.datatype = 'uinteger';
		o.placeholder = '30';
		o.depends('transport__tcpMux', 'true');
		o.depends('transport__tcpMux', '');
		o.modalonly = true;

		/* ---- Server CRUD state-machine wrappers ---- */
		const renderServerModal = serverGrid.renderMoreOptionsModal;
		serverGrid.renderMoreOptionsModal = function(sectionId) {
			serverRequiredArmed.delete(sectionId);
			return Promise.resolve(renderServerModal.apply(this, arguments)).then(function(node) {
				/* The router inserts the modal DOM synchronously in ui.showModal(),
				 * but defer the restructure to the next frame so any remaining
				 * post-render wiring is complete before we move option rows. */
				requestAnimationFrame(function() {
					layoutServerModal(serverGrid, sectionId);
				});
				return node;
			});
		};

		const cancelServerModal = serverGrid.handleModalCancel;
		serverGrid.handleModalCancel = function(modalMap) {
			const sectionId = modalMap && modalMap.section;
			if (sectionId)
				serverRequiredArmed.delete(sectionId);
			return cancelServerModal.apply(this, arguments);
		};

		const saveServerModal = serverGrid.handleModalSave;
		serverGrid.handleModalSave = function(modalMap) {
			const sectionId = modalMap && modalMap.section;
			if (sectionId)
				serverRequiredArmed.set(sectionId, true);
			const prevNode = this.getPreviousModalMap();
			const prevMap = prevNode && dom.findClassInstance(prevNode) || this.map;
			const addedSectionId = prevMap && prevMap.addedSection;
			const addedSection = addedSectionId && this.map.data.get('frpc-advanced', addedSectionId);
			const beforeIds = new Set(uci.sections('frpc-advanced', 'server')
				.map(function(p) { return p['.name']; }).filter(function(id) { return id !== addedSectionId; }));

			return Promise.resolve(saveServerModal.apply(this, arguments)).then(L.bind(function() {
				if (sectionId)
					serverRequiredArmed.delete(sectionId);
				const activeModal = this.getActiveModalMap();
				const profiles = uci.sections('frpc-advanced', 'server');

				let created = addedSection && addedSection['.name'];
				if (!profiles.some(function(p) { return p['.name'] === created; })) {
					const found = profiles.find(function(p) { return !beforeIds.has(p['.name']); });
					created = found && found['.name'];
				}

				/* Failed add/edit bail-out. */
				if ((addedSectionId && (!created || created === addedSectionId)) ||
					(!addedSectionId && activeModal && activeModal.querySelector('.cbi-value')))
					return;

				const isFirst = beforeIds.size === 0 && !!created;
				if (isFirst) {
					currentServerOption.map.data.set('frpc-advanced', 'main', 'server', created);
					return currentServerOption.map.data.save().then(function() {
						syncServerSelector(created, true);
						if (activeModal && !activeModal.querySelector('.cbi-value'))
							ui.hideModal();
					});
				}

				syncServerSelector(null, false);
				if (activeModal && !activeModal.querySelector('.cbi-value'))
					ui.hideModal();
			}, this));
		};

		const removeServerProfile = serverGrid.handleRemove;
		serverGrid.handleRemove = function(sectionId) {
			const current = currentServerOption.formvalue('main') ||
				currentServerOption.map.data.get('frpc-advanced', 'main', 'server');

			if (current === sectionId) {
				const remaining = currentServerOption.map.data.sections('frpc-advanced', 'server')
					.filter(function(p) { return p['.name'] !== sectionId; });
				const replacement = remaining.length ? remaining[0]['.name'] : '';

				if (replacement)
					currentServerOption.map.data.set('frpc-advanced', 'main', 'server', replacement);
				else
					currentServerOption.map.data.unset('frpc-advanced', 'main', 'server');

				/* Pre-set widget value WITHOUT dispatching change --
				 * validator must see effective server set AFTER native remove marks deletion. */
				const frame = currentServerOption.map.findElement('id', currentServerOption.cbid('main'));
				const select = frame && (frame.matches('select') ? frame : frame.querySelector('select'));
				if (select)
					select.value = replacement;
			}

			return Promise.resolve(removeServerProfile.apply(this, arguments)).then(function() {
				syncServerSelector(null, false);
			});
		};
		// Proxy and visitor rules
		s = m.section(form.GridSection, 'rule', _('Proxy and Visitor Rules'));
		s.anonymous = true;
		s.addremove = true;
		s.sortable = true;
		s.addbtntitle = _('Add Rule');
		s.tab('basic', _('Basic Settings'));
		s.tab('advanced', _('Advanced Settings'));
		const ruleGrid = s;
		s.modaltitle = function(sectionId) {
			const section = this.map.data.get('frpc-advanced', sectionId);
			if (!section || !section.name) return _('Add Rule');
			return '%s - %s'.format(_('Edit Rule'), section.name);
		};

		o = setSwitch(s.taboption('basic', form.Flag, 'enabled', _('Enable')), true);
		o.modalonly = null;
		o.editable = true;
		const ruleEnabledOption = o;
		const renderRuleEnabledWidget = ruleEnabledOption.renderWidget;
		ruleEnabledOption.renderWidget = function(sectionId, optionIndex, cfgvalue) {
			if (this.map && this.map.parent) {
				const parentFound = this.map.parent.lookupOption(this.option, sectionId);
				const parentOption = parentFound && parentFound[0];
				if (parentOption && parentOption.getUIElement(sectionId))
					cfgvalue = parentOption.formvalue(sectionId);
			}

			return Promise.resolve(renderRuleEnabledWidget.call(this,
				sectionId, optionIndex, cfgvalue)).then((widget) => {
				if (!this.map.parent && widget && widget.classList) {
					widget.classList.add('frpc-rule-switch');
					const input = widget.querySelector('input[type="checkbox"]');
					if (input) {
						input.setAttribute('role', 'switch');
						input.setAttribute('aria-label', _('Enable'));
						input.setAttribute('aria-checked', input.checked ? 'true' : 'false');
						input.addEventListener('change', function() {
							input.setAttribute('aria-checked', input.checked ? 'true' : 'false');
						});
					}
				}
				return widget;
			});
		};
		o = s.taboption('basic', form.Value, 'name', _('Name'));
		o.validate = validateRuleName;
		o.modalonly = true;
		o = s.taboption('basic', form.ListValue, 'type', _('Type'));
		for (const type of RULE_TYPES)
			o.value(type, type.toUpperCase());
		o.default = 'tcp';
		o.rmempty = false;
		o.validate = validateRuleType;
		o.modalonly = true;
		const ruleTypeOption = o;

		o = setSwitch(s.taboption('advanced', form.Flag, 'visitor', _('Visitor mode'),
			_('Connects to an STCP, XTCP, or SUDP private proxy published by another FRPC client.')), false);
		o.modalonly = true;
		const visitorOption = o;
		const renderVisitorWidget = visitorOption.renderWidget;
		visitorOption.renderWidget = function(sectionId) {
			return Promise.resolve(renderVisitorWidget.apply(this, arguments)).then(function(widget) {
				const input = widget && widget.querySelector('input[type="checkbox"]');
				function syncTypeChoices() {
					/* GridSection modals live outside map.root, so getUIElement() cannot
					 * find this ListValue. Resolve the frame through its canonical cbid. */
					const typeFrame = document.getElementById(ruleTypeOption.cbid(sectionId));
					const select = typeFrame && typeFrame.querySelector('select');
					if (!select || !input) return;
					const visitorEnabled = input.checked === true;
					const choices = visitorEnabled ? VISITOR_TYPES : RULE_TYPES;
					const current = select.value;
					const renderedChoices = Array.from(select.options).map(function(option) { return option.value; });
					if (renderedChoices.join('\n') !== choices.join('\n')) {
						select.innerHTML = '';
						for (const type of choices)
							select.appendChild(E('option', { value: type }, type.toUpperCase()));
					}
					const next = choices.includes(current) ? current : (visitorEnabled ? 'stcp' : 'tcp');
					select.value = next;
					if (next !== current)
						select.dispatchEvent(new Event('change', { bubbles: true }));
				}
				if (input) {
					input.addEventListener('change', function() { window.setTimeout(syncTypeChoices, 0); });
					window.setTimeout(syncTypeChoices, 0);
				}
				return widget;
			});
		};

		o = gridOnly(s.option(form.DummyValue, '_name_grid', _('Name')));
		o.modalonly = false;
		o.cfgvalue = function(sectionId) {
			return this.map.data.get('frpc-advanced', sectionId, 'name') || '—';
		};
		o = gridOnly(s.option(form.DummyValue, '_type_grid', _('Type')));
		o.modalonly = false;
		o.cfgvalue = function(sectionId) {
			return (this.map.data.get('frpc-advanced', sectionId, 'type') || 'tcp').toUpperCase();
		};

		o = gridOnly(s.option(form.DummyValue, '_local_target', _('Local / Bind')));
		o.modalonly = false;
		o.cfgvalue = function(sectionId) {
			const section = this.map.data.get('frpc-advanced', sectionId) || {};
			if (section.visitor === '1')
				return section.bindPort ? '%s:%s'.format(section.bindAddr || '127.0.0.1', section.bindPort) : '—';
			if (section.PlUgIn_type)
				return section.localAddr || section.unixPath || section.localPath || '—';
			return section.localPort ? '%s:%s'.format(section.localIP || '127.0.0.1', section.localPort) : '—';
		};
		o = gridOnly(s.option(form.DummyValue, '_remote_entry', _('Remote Configuration')));
		o.modalonly = false;
		o.cfgvalue = function(sectionId) {
			const getRuleValue = (option) => this.map.data.get('frpc-advanced', sectionId, option);
			const summarySection = this.map.data.get('frpc-advanced', sectionId) || {};
			const type = String(summarySection.type || '').toLowerCase();
			if (getRuleValue('visitor') === '1') {
				const serverName = String(getRuleValue('serverName') || '').trim();
				const serverUser = String(getRuleValue('serverUser') || '').trim();
				if (!serverName) return '—';
				const target = serverUser ? '%s.%s'.format(serverUser, serverName) : serverName;
				return '%s%s'.format(_('Target:'), target);
			}
			if (type === 'tcp' || type === 'udp') {
				const remotePort = getRuleValue('remotePort');
				if (String(remotePort) === '0') return '%s%s'.format(_('Port:'), _('Random'));
				return remotePort ? '%s%s'.format(_('Port:'), remotePort) : '—';
			}
			if (type === 'http' || type === 'https' || type === 'tcpmux') {
				let domains = getRuleValue('customDomains') || [];
				if (!Array.isArray(domains)) domains = String(domains).split(/\s*,\s*/);
				domains = domains.map(function(domain) { return String(domain || '').trim(); })
					.filter(function(domain) { return domain; });
				const lines = [];
				for (const domain of domains)
					lines.push('%s%s'.format(_('Domains:'), domain));
				const subdomain = String(getRuleValue('subdomain') || '').trim();
				if (!domains.length && subdomain)
					lines.push('%s%s'.format(_('Subdomain:'), subdomain));
				return lines.length ? lines.join('\n') : '—';
			}
			if (VISITOR_TYPES.includes(type)) return _('Private proxy');
			return '—';
		};

		o = s.taboption('basic', form.Value, 'localIP', _('Local address'));
		o.datatype = 'host';
		o.placeholder = '127.0.0.1';
		o.depends({ visitor: '0', PlUgIn_type: '' });
		o.modalonly = true;
		o = s.taboption('basic', form.Value, 'localPort', _('Local port'));
		o.datatype = 'port';
		o.validate = function(sectionId, value) {
			if (value == null || String(value).trim() === '')
				return isRuleRequiredArmed(sectionId) ? _('Local port is required.') : true;
			return true;
		};
		o.depends({ visitor: '0', PlUgIn_type: '' });
		o.modalonly = true;
		o = s.taboption('basic', form.Value, 'remotePort', _('Remote port'),
			_('Leave empty to let FRPS assign a random remote port. Setting 0 has the same effect.'));
		o.datatype = 'uinteger';
		o.depends({ visitor: '0', type: 'tcp' });
		o.depends({ visitor: '0', type: 'udp' });
		o.modalonly = true;

		o = s.taboption('basic', form.DynamicList, 'customDomains', _('Custom domains'));
		for (const type of ['http', 'https', 'tcpmux'])
			o.depends({ visitor: '0', type: type });
		o.modalonly = true;
		o = s.taboption('basic', form.Value, 'subdomain', _('Subdomain'));
		o.validate = function(sectionId, value) { return validateDomainPair.call(this, sectionId, value, 'customDomains'); };
		for (const type of ['http', 'https', 'tcpmux'])
			o.depends({ visitor: '0', type: type });
		o.modalonly = true;

		for (const field of [
			['serverName', _('Server name')],
			['serverUser', _('Server user'), _('Leave empty to use the current Frpc user.')],
			['bindAddr', _('Visitor bind address')],
			['bindPort', _('Visitor bind port')]
		]) {
			o = withFieldHelp(s.taboption('basic', form.Value, field[0], field[1], field[2]));
			if (field[0] === 'bindAddr') o.datatype = 'host';
			if (field[0] === 'bindPort') o.datatype = 'integer';
			if (field[0] === 'serverName' || field[0] === 'bindPort') {
				o.optional = true;
				o.validate = function(sectionId, value) {
					if (!this.map.isDependencySatisfied(this.deps, this.config, sectionId))
						return true;
					if (value == null || String(value).trim() === '') {
						if (!isRuleRequiredArmed(sectionId))
							return true;
						return _('This field is required in visitor mode.');
					}
					return true;
				};
			}
			o.depends('visitor', '1');
			o.modalonly = true;
		}
		o = withFieldHelp(s.taboption('basic', form.Value, 'secretKey', _('Secret key')));
		o.password = true;
		for (const type of VISITOR_TYPES)
			o.depends('type', type);
		o.optional = true;
		o.validate = function(sectionId, value) {
			if (!this.map.isDependencySatisfied(this.deps, this.config, sectionId))
				return true;
			if (value == null || String(value).trim() === '') {
				if (!isRuleRequiredArmed(sectionId))
					return true;
				return _('This field is required for private proxies.');
			}
			return true;
		};
		o.modalonly = true;

		o = s.taboption('advanced', form.DynamicList, 'allowUsers', _('Allowed users'),
			_('FRPC users allowed to access this private proxy. Leave empty to allow only the same user; enter `*` to allow all users.'));
		for (const type of VISITOR_TYPES)
			o.depends({ visitor: '0', type: type });
		o.modalonly = true;

		o = s.taboption('advanced', form.ListValue, 'protocol', _('XTCP protocol'));
		o.value('quic');
		o.value('kcp');
		o.depends({ visitor: '1', type: 'xtcp' });
		o.modalonly = true;

		for (const field of [
			['maxRetriesAnHour', _('Max retries per hour')],
			['minRetryInterval', _('Minimum retry interval')],
			['fallbackTo', _('Fallback visitor')],
			['fallbackTimeoutMs', _('Fallback timeout (ms)')]
		]) {
			o = s.taboption('advanced', form.Value, field[0], field[1]);
			if (field[0] !== 'fallbackTo') o.datatype = field[0] === 'fallbackTimeoutMs' ? 'uinteger' : 'integer';
			o.depends({ visitor: '1', type: 'xtcp' });
			o.modalonly = true;
		}
		o = frpcBoolDefaultFalse(s.taboption('advanced', form.Flag, 'keepTunnelOpen', _('Keep tunnel open'),
			_('FRP default: Disabled. Enable only for long-lived XTCP connections.')));
		o.depends({ visitor: '1', type: 'xtcp' });
		o.modalonly = true;

		o = frpcBoolDefaultFalse(s.taboption('advanced', form.Flag, 'natTraversal__disableAssistedAddrs', _('Disable assisted NAT addresses'),
			_('For XTCP, use only STUN-discovered public addresses instead of local network interfaces. FRP default: Disabled.')));
		o.depends({ visitor: '1', type: 'xtcp' });
		o.depends({ visitor: '0', type: 'xtcp' });
		o.modalonly = true;

		o = s.taboption('advanced', form.DynamicList, 'locations', _('Locations'));
		o.depends({ visitor: '0', type: 'http' });
		o.modalonly = true;
		o = withFieldHelp(s.taboption('advanced', form.Value, 'hostHeaderRewrite', _('Host header rewrite')));
		o.depends({ visitor: '0', type: 'http' });
		o.modalonly = true;
		o = s.taboption('advanced', form.Value, 'httpUser', _('HTTP user'));
		o.depends({ visitor: '0', type: 'http' });
		o.depends({ visitor: '0', type: 'tcpmux' });
		o.modalonly = true;
		o = s.taboption('advanced', form.Value, 'httpPassword', _('HTTP password'));
		o.password = true;
		o.depends({ visitor: '0', type: 'http' });
		o.depends({ visitor: '0', type: 'tcpmux' });
		o.modalonly = true;
		o = s.taboption('advanced', form.Value, 'routeByHTTPUser', _('Route by HTTP user'));
		o.depends({ visitor: '0', type: 'http' });
		o.depends({ visitor: '0', type: 'tcpmux' });
		o.modalonly = true;

		o = s.taboption('advanced', form.Value, 'transport__bandwidthLimit', _('Bandwidth limit'), _('Example: 3MB or 500KB.'));
		o.depends('visitor', '0');
		o.modalonly = true;
		o = withFieldHelp(s.taboption('advanced', form.ListValue, 'transport__bandwidthLimitMode', _('Bandwidth limit mode'),
			_('FRP default: Client side.')));
		o.value('', _('Default'));
		o.value('client', _('Client Side'));
		o.value('server', _('Server Side'));
		o.depends('visitor', '0');
		o.modalonly = true;
		o = frpcBoolDefaultFalse(s.taboption('advanced', form.Flag, 'transport__useEncryption', _('Use encryption'),
			_('FRP default: Disabled. Enable only when you need per-proxy encryption.')));
		o.modalonly = true;
		o = frpcBoolDefaultFalse(s.taboption('advanced', form.Flag, 'transport__useCompression', _('Use compression'),
			_('FRP default: Disabled. Enable only when bandwidth is very limited.')));
		o.modalonly = true;
		o = s.taboption('advanced', form.ListValue, 'transport__proxyProtocolVersion', _('PROXY Protocol Version'),
			_('Passes original connection information to the local backend, which must support PROXY Protocol. Disabled by default and unrelated to the internal FRP protocol between FRPC and FRPS.'));
		o.value('', _('None'));
		o.value('v1');
		o.value('v2');
		o.default = '';
		o.depends('visitor', '0');
		o.modalonly = true;

		o = s.taboption('advanced', form.Value, 'loadBalancer__group', _('Load balancer group'));
		o.depends('visitor', '0');
		o.modalonly = true;
		o = s.taboption('advanced', form.Value, 'loadBalancer__groupKey', _('Load balancer group key'));
		o.password = true;
		o.depends('visitor', '0');
		o.modalonly = true;

		o = s.taboption('advanced', form.ListValue, 'healthCheck__type', _('Health check type'));
		o.value('', _('Disabled'));
		o.value('tcp', _('TCP'));
		o.value('http', _('HTTP'));
		o.depends('visitor', '0');
		o.modalonly = true;
		o = s.taboption('advanced', form.Value, 'healthCheck__path', _('Health check HTTP path'));
		o.optional = true;
		o.validate = function(sectionId, value) {
			if (!this.map.isDependencySatisfied(this.deps, this.config, sectionId))
				return true;
			if (value == null || String(value).trim() === '') {
				if (!isRuleRequiredArmed(sectionId))
					return true;
				return _('This field is required for HTTP health checks.');
			}
			return true;
		};
		o.depends({ visitor: '0', healthCheck__type: 'http' });
		o.modalonly = true;
		for (const field of [
			['healthCheck__timeoutSeconds', _('Health check timeout'), '3'],
			['healthCheck__maxFailed', _('Health check max failures'), '1'],
			['healthCheck__intervalSeconds', _('Health check interval'), '10']
		]) {
			o = s.taboption('advanced', form.Value, field[0], field[1]);
			o.datatype = 'uinteger';
			o.placeholder = field[2];
			o.depends({ visitor: '0', healthCheck__type: 'tcp' });
			o.depends({ visitor: '0', healthCheck__type: 'http' });
			o.modalonly = true;
		}

		o = withFieldHelp(s.taboption('advanced', form.ListValue, 'PlUgIn_type', _('Plugin type')));
		o.value('', _('None'));
		for (const plugin of ['socks5', 'http_proxy', 'static_file', 'unix_domain_socket', 'https2http', 'https2https', 'http2https', 'http2http', 'tls2raw'])
			o.value(plugin);
		o.depends('visitor', '0');
		o.validate = validatePluginType;
		o.modalonly = true;

		const pluginFields = [
			['unixPath', _('Plugin Unix socket path'), ['unix_domain_socket'], false, ['unix_domain_socket']],
			['username', _('Plugin username'), ['socks5'], false, []],
			['password', _('Plugin password'), ['socks5'], true, []],
			['localPath', _('Plugin local path'), ['static_file'], false, ['static_file']],
			['stripPrefix', _('Plugin strip prefix'), ['static_file'], false, []],
			['PlUgIn_httpUser', _('Plugin HTTP user'), ['http_proxy', 'static_file'], false, []],
			['PlUgIn_httpPassword', _('Plugin HTTP password'), ['http_proxy', 'static_file'], true, []],
			['localAddr', _('Plugin local address'), ['https2http', 'https2https', 'http2https', 'http2http', 'tls2raw'], false, ['https2http', 'https2https', 'http2https', 'tls2raw']],
			['crtPath', _('Plugin certificate path'), ['https2http', 'https2https', 'tls2raw'], false, []],
			['keyPath', _('Plugin key path'), ['https2http', 'https2https', 'tls2raw'], false, []],
			['PlUgIn_hostHeaderRewrite', _('Plugin host header rewrite'), ['https2http', 'https2https', 'http2https', 'http2http'], false, []]
		];
		for (const field of pluginFields) {
			o = s.taboption('advanced', form.Value, field[0], field[1]);
			for (const plugin of field[2]) o.depends({ visitor: '0', PlUgIn_type: plugin });
			if (field[3]) o.password = true;
			if (field[4].length) o.validate = function(sectionId, value) { return validatePluginRequired.call(this, sectionId, value, field[4]); };
			o.modalonly = true;
		}
		o = frpcBoolDefaultTrue(s.taboption('advanced', form.Flag, 'enableHTTP2', _('Plugin enable HTTP/2'),
			_('FRP default: Enabled. Disable only when the backend does not support HTTP/2.')));
		o.depends({ visitor: '0', PlUgIn_type: 'https2http' });
		o.depends({ visitor: '0', PlUgIn_type: 'https2https' });
		o.modalonly = true;

		o = s.taboption('advanced', form.DynamicList, 'extra_options', _('Rule extra options'),
			_('Advanced raw TOML lines appended to this proxy or visitor.'));
		o.placeholder = 'option = value';
		o.modalonly = true;
		o = withFieldHelp(s.taboption('advanced', form.DynamicList, 'extra_options_plugin', _('Plugin extra options')));
		o.placeholder = 'option = value';
		for (const plugin of ['unix_domain_socket', 'http_proxy', 'socks5', 'static_file', 'https2http', 'https2https', 'http2https', 'http2http', 'tls2raw'])
			o.depends({ visitor: '0', PlUgIn_type: plugin });
		o.modalonly = true;

		const renderRuleModal = ruleGrid.renderMoreOptionsModal;
		ruleGrid.renderMoreOptionsModal = function(sectionId) {
			ruleRequiredArmed.delete(sectionId);
			const found = this.map.lookupOption('enabled', sectionId);
			const option = found && found[0];
			this.modalEnabledDraft = option && option.getUIElement(sectionId)
				? { sectionId: sectionId, value: option.formvalue(sectionId) } : null;
			return Promise.resolve(renderRuleModal.apply(this, arguments)).then((result) => {
				const draft = this.modalEnabledDraft;
				const modalNode = this.getActiveModalMap();
				const input = modalNode && modalNode.querySelector('input[type="checkbox"]');
				if (draft && draft.sectionId === sectionId && input) {
					input.checked = draft.value === '1';
					input.dispatchEvent(new Event('change', { bubbles: true }));
				}
				requestAnimationFrame(function() {
					layoutRuleModal(ruleGrid, sectionId);
				});
				return result;
			});
		};

		const cancelRuleModal = ruleGrid.handleModalCancel;
		ruleGrid.handleModalCancel = function(modalMap, ev, isSaving) {
			const sectionId = modalMap && modalMap.section;
			if (sectionId)
				ruleRequiredArmed.delete(sectionId);
			const draft = this.modalEnabledDraft;
			return Promise.resolve(cancelRuleModal.apply(this, arguments)).then(() => {
				delete this.modalEnabledDraft;
				if (isSaving || !draft)
					return;
				const found = this.map.lookupOption('enabled', draft.sectionId);
				const option = found && found[0];
				const element = option && option.getUIElement(draft.sectionId);
				if (element) {
					element.setValue(draft.value);
					const input = document.querySelector('#cbi-frpc-advanced-' + draft.sectionId +
						' td[data-name="enabled"] input[type="checkbox"]');
					if (input)
						input.setAttribute('aria-checked', draft.value === '1' ? 'true' : 'false');
				}
			});
		};

		const saveRuleModal = ruleGrid.handleModalSave;
		ruleGrid.handleModalSave = function(modalMap) {
			const sectionId = modalMap && modalMap.section;
			if (sectionId)
				ruleRequiredArmed.set(sectionId, true);
			return Promise.resolve(saveRuleModal.apply(this, arguments)).then(function(result) {
				if (sectionId)
					ruleRequiredArmed.delete(sectionId);
				return result;
			});
		};

		function postProcessForm(root) {
			applyUiMode(root, currentMode);
			repairWidgetLabels(root);

			syncServerSelector(null, false);

			/* Match FRPS: only query the saved executable path. */
			const binRow = root.querySelector('[id$="-client_file"]');
			if (binRow) {
				const binInput = binRow.querySelector('input');
				const binField = binRow.querySelector('.cbi-value-field');
				const statusEl = E('span', { class: 'frp-version-checking' }, _('Detecting version…'));
				const versionLine = E('div', { class: 'frp-version-line' }, statusEl);
				if (binField) binField.appendChild(versionLine);
				let savedPath = '/usr/bin/frpc';
				for (let i = 0; i < s.children.length; i++) {
					if (s.children[i].option === 'client_file') {
						try {
							const configuredPath = s.children[i].cfgvalue('main');
							if (configuredPath) savedPath = configuredPath;
						}
						catch (e) {}
						break;
					}
				}
				let lastChecked = null;

				function setVersionStatus(cls, textOrNode) {
					statusEl.className = cls;
					statusEl.innerHTML = '';
					if (typeof textOrNode === 'string')
						statusEl.textContent = textOrNode;
					else if (textOrNode)
						statusEl.appendChild(textOrNode);
				}

				function detectVersion() {
					let path = (binInput.value || '').trim();
					if (!path) path = '/usr/bin/frpc';
					if (path !== savedPath) {
						lastChecked = null;
						setVersionStatus('frp-version-pending', _('Check version after saving the new path'));
						return;
					}
					if (path === lastChecked) return;
					lastChecked = path;
					setVersionStatus('frp-version-checking', _('Detecting version…'));
					L.resolveDefault(callGetVersion()).then(function(result) {
						if (path !== lastChecked) return;
						let response = result;
						if (result && typeof result === 'object' && result.result && typeof result.result === 'object')
							response = result.result;
						if (response && response.status === 'ok' && response.version) {
							setVersionStatus('', E('span', { class: 'frp-version-ok' }, [
								E('span', { class: 'frp-version-label' }, _('Current version') + ' '),
								E('strong', { class: 'frp-version-value' }, response.version)
							]));
						}
						else if (response && response.status === 'error' &&
							(response.code === 'not_executable' || response.code === 'invalid_path')) {
							setVersionStatus('frp-version-missing', _('Frp executable not found; install or upload it and retry'));
						}
						else {
							setVersionStatus('frp-version-error', _('Unable to read version; refresh and retry'));
						}
					}, function() {
						if (path !== lastChecked) return;
						setVersionStatus('frp-version-error', _('Unable to read version; refresh and retry'));
					});
				}

				detectVersion();
				binInput.addEventListener('change', function() {
					clearTimeout(binInput.__frpCheckTimer);
					binInput.__frpCheckTimer = setTimeout(detectVersion, 400);
				});
				binInput.addEventListener('blur', function() {
					clearTimeout(binInput.__frpCheckTimer);
					binInput.__frpCheckTimer = setTimeout(detectVersion, 250);
				});
			}
		}

		m._frpcPostProcess = function() {
			const root = m.root ? m.root.closest('.frpc-advanced-root') : null;
			if (root)
				postProcessForm(root);
		};

		return m.render().then(function(content) {
			const root = E('div', { class: 'frpc-advanced-root' }, [pageDescription, statusPanel, renderModeSelector(), content]);
			postProcessForm(root);
			return root;
		});
	}
});
