'use strict';
'require view.frpc_advanced_ui_base as base';

var STYLE_ID = 'frpc-modal-balance-style-v6';
var OBSERVER_KEY = '__frpcPasswordLayoutObserverV6';

function ensureBalanceStyle() {
	if (document.getElementById(STYLE_ID))
		return;

	var style = document.createElement('style');
	style.id = STYLE_ID;
	style.textContent = `
/* Advanced modal: flatten the old left/right columns into one real 2x2 grid. */
.modal.cbi-modal.frpc-left-modal .frpc-adv-main,
.modal.cbi-modal.frpc-left-modal .frpc-rule-advanced-layout {
	display: grid !important;
	grid-template-columns: minmax(0,1fr) minmax(0,1fr) !important;
	gap: 10px !important;
	align-items: stretch !important;
}
.modal.cbi-modal.frpc-left-modal .frpc-adv-column,
.modal.cbi-modal.frpc-left-modal .frpc-rule-column {
	display: contents !important;
}

/* Server advanced settings: synchronized rows for a balanced left/right layout. */
.modal.cbi-modal.frpc-left-modal .frpc-adv-auth {
	grid-column: 1 !important;
	grid-row: 1 !important;
	z-index: 30 !important;
}
.modal.cbi-modal.frpc-left-modal .frpc-adv-conn {
	grid-column: 2 !important;
	grid-row: 1 !important;
	z-index: 30 !important;
}
.modal.cbi-modal.frpc-left-modal .frpc-adv-tls {
	grid-column: 1 !important;
	grid-row: 2 !important;
	z-index: 10 !important;
}
.modal.cbi-modal.frpc-left-modal .frpc-oidc-group {
	grid-column: 2 !important;
	grid-row: 2 !important;
	z-index: 10 !important;
}

/* Rule advanced settings: the same 2x2 card rhythm as the server modal. */
.modal.cbi-modal.frpc-left-modal .frpc-rule-group-access {
	grid-column: 1 !important;
	grid-row: 1 !important;
	z-index: 30 !important;
}
.modal.cbi-modal.frpc-left-modal .frpc-rule-group-transport {
	grid-column: 2 !important;
	grid-row: 1 !important;
	z-index: 30 !important;
}
.modal.cbi-modal.frpc-left-modal .frpc-rule-group-health {
	grid-column: 1 !important;
	grid-row: 2 !important;
	z-index: 10 !important;
}
.modal.cbi-modal.frpc-left-modal .frpc-rule-group-extension {
	grid-column: 2 !important;
	grid-row: 2 !important;
	z-index: 10 !important;
}

/* LuCI dropdowns must be able to escape the card and sit above the next row. */
.modal.cbi-modal.frpc-left-modal .frpc-adv-auth,
.modal.cbi-modal.frpc-left-modal .frpc-adv-conn,
.modal.cbi-modal.frpc-left-modal .frpc-adv-tls,
.modal.cbi-modal.frpc-left-modal .frpc-oidc-group,
.modal.cbi-modal.frpc-left-modal .frpc-rule-group-access,
.modal.cbi-modal.frpc-left-modal .frpc-rule-group-transport,
.modal.cbi-modal.frpc-left-modal .frpc-rule-group-health,
.modal.cbi-modal.frpc-left-modal .frpc-rule-group-extension {
	position: relative !important;
	overflow: visible !important;
}
.modal.cbi-modal.frpc-left-modal .cbi-dropdown {
	position: relative !important;
	z-index: 60 !important;
}
.modal.cbi-modal.frpc-left-modal .cbi-dropdown.open,
.modal.cbi-modal.frpc-left-modal .cbi-dropdown[open],
.modal.cbi-modal.frpc-left-modal .cbi-dropdown > ul {
	z-index: 80 !important;
}

/* Keep native LuCI dependency visibility authoritative. */
.modal.cbi-modal.frpc-left-modal .frpc-adv-main .cbi-value.hidden,
.modal.cbi-modal.frpc-left-modal .frpc-rule-advanced-layout .cbi-value.hidden,
.modal.cbi-modal.frpc-left-modal .frpc-left-basic-pane .cbi-value.hidden {
	display: none !important;
}

/* Bandwidth-limit mode already has a help tooltip; the inline default description is redundant. */
.modal.cbi-modal.frpc-left-modal [id$="-transport__bandwidthLimitMode"] .cbi-value-description {
	display: none !important;
}

/* Password fields: shorten only the input and pin LuCI's reveal button to the far right. */
.modal.cbi-modal.frpc-left-modal .frpc-password-field {
	position: relative !important;
	box-sizing: border-box !important;
	padding-right: 38px !important;
	min-width: 0 !important;
}
.modal.cbi-modal.frpc-left-modal .frpc-password-field .frpc-password-input {
	box-sizing: border-box !important;
	width: 100% !important;
	max-width: none !important;
	min-width: 0 !important;
}
.modal.cbi-modal.frpc-left-modal .frpc-password-field .frpc-password-toggle {
	position: absolute !important;
	top: 0 !important;
	right: 0 !important;
	box-sizing: border-box !important;
	width: 34px !important;
	min-width: 34px !important;
	max-width: 34px !important;
	height: 100% !important;
	max-height: 40px !important;
	margin: 0 !important;
	z-index: 2 !important;
}

@media (max-width: 899px) {
	.modal.cbi-modal.frpc-left-modal .frpc-adv-main,
	.modal.cbi-modal.frpc-left-modal .frpc-rule-advanced-layout {
		grid-template-columns: minmax(0,1fr) !important;
	}
	.modal.cbi-modal.frpc-left-modal .frpc-adv-auth { grid-column: 1 !important; grid-row: 1 !important; }
	.modal.cbi-modal.frpc-left-modal .frpc-adv-conn { grid-column: 1 !important; grid-row: 2 !important; }
	.modal.cbi-modal.frpc-left-modal .frpc-adv-tls { grid-column: 1 !important; grid-row: 3 !important; }
	.modal.cbi-modal.frpc-left-modal .frpc-oidc-group { grid-column: 1 !important; grid-row: 4 !important; }
	.modal.cbi-modal.frpc-left-modal .frpc-rule-group-access { grid-column: 1 !important; grid-row: 1 !important; }
	.modal.cbi-modal.frpc-left-modal .frpc-rule-group-transport { grid-column: 1 !important; grid-row: 2 !important; }
	.modal.cbi-modal.frpc-left-modal .frpc-rule-group-health { grid-column: 1 !important; grid-row: 3 !important; }
	.modal.cbi-modal.frpc-left-modal .frpc-rule-group-extension { grid-column: 1 !important; grid-row: 4 !important; }
}
`;
	document.head.appendChild(style);
}

function decoratePasswordFields() {
	var inputs = document.querySelectorAll('.modal.cbi-modal.frpc-left-modal input[type="password"], .modal.cbi-modal.frpc-left-modal input.frpc-password-input');
	for (var i = 0; i < inputs.length; i++) {
		var input = inputs[i];
		var field = input.closest ? input.closest('.cbi-value-field') : null;
		if (!field)
			continue;

		input.classList.add('frpc-password-input');
		field.classList.add('frpc-password-field');

		var buttons = field.querySelectorAll('button');
		for (var b = 0; b < buttons.length; b++) {
			var button = buttons[b];
			if (button === input)
				continue;
			button.classList.add('frpc-password-toggle');
			break;
		}
	}
}

function observePasswordFields() {
	if (!document.body || document.body[OBSERVER_KEY])
		return;

	var scheduled = false;
	var observer = new MutationObserver(function() {
		if (scheduled)
			return;
		scheduled = true;
		setTimeout(function() {
			scheduled = false;
			decoratePasswordFields();
		}, 0);
	});
	observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['type', 'class'] });
	document.body[OBSERVER_KEY] = observer;
}

return base.constructor.extend({
	__init__: function() {
		ensureBalanceStyle();
		decoratePasswordFields();
		observePasswordFields();
	}
});
