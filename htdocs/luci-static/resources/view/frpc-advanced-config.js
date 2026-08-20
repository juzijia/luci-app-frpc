'use strict';
'require view.frpc_advanced_config_base as base';

var styleId = 'frpc-toml-left-align-style';

function alignTomlCompare() {
	var grid = document.querySelector('.frpc-toml-compare-grid');
	if (!grid) return false;

	if (!document.getElementById(styleId)) {
		var style = document.createElement('style');
		style.id = styleId;
		style.textContent =
			'.frpc-toml-left{box-sizing:border-box!important;width:calc(100% - 16px)!important;max-width:1250px!important;margin-left:8px!important;margin-right:0!important}' +
			'@media(max-width:1000px){.frpc-toml-left{width:100%!important;margin-left:0!important}.frpc-toml-compare-grid{grid-template-columns:1fr!important}}';
		document.head.appendChild(style);
	}

	grid.classList.add('frpc-toml-left');

	var toolbar = grid.previousElementSibling;
	if (toolbar)
		toolbar.classList.add('frpc-toml-left');

	var warning = toolbar && toolbar.previousElementSibling;
	if (warning)
		warning.classList.add('frpc-toml-left');

	return true;
}

function observeTomlCompare() {
	if (!document.body || document.body.__frpcTomlLeftObserver) return;
	var observer = new MutationObserver(function() {
		if (alignTomlCompare())
			observer.disconnect();
	});
	observer.observe(document.body, { childList: true, subtree: true });
	document.body.__frpcTomlLeftObserver = observer;
}

return base.constructor.extend({
	__init__: function() {
		if (!alignTomlCompare())
			observeTomlCompare();
	}
});