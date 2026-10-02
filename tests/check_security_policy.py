"""Check the core-path and ACL contracts without executing OpenWrt services."""

import json
import re
from pathlib import Path

root = Path(__file__).resolve().parents[1]
init = (root / 'root/etc/init.d/frpc-advanced').read_text(encoding='utf-8')
rpc = (root / 'root/usr/share/rpcd/ucode/frpc-advanced.uc').read_text(encoding='utf-8')
view = (root / 'htdocs/luci-static/resources/view/frpc_advanced_base.js').read_text(encoding='utf-8')
core = re.search(r'^DEFAULT_CLIENT_FILE="([^"]+)"$', init, re.M).group(1)
assert core == '/usr/bin/frpc'
assert re.search(r"const DEFAULT_CLIENT_FILE = '([^']+)';", rpc).group(1) == core
field = view.split("form.Value, 'client_file'", 1)[1].split('\n\n', 1)[0]
assert re.search(r"o.default = '([^']+)';", field).group(1) == core
assert 'client_file:or(\\"$DEFAULT_CLIENT_FILE\\"):$DEFAULT_CLIENT_FILE' in init
assert 'procd_set_param command "$DEFAULT_CLIENT_FILE"' in init
assert '"$DEFAULT_CLIENT_FILE" verify -c' in init
version = rpc.split('get_version: {', 1)[1].split('get_config_compare: {', 1)[0]
assert 'path != DEFAULT_CLIENT_FILE' in version
assert 'command: DEFAULT_CLIENT_FILE' in version

acl = json.loads((root / 'root/usr/share/rpcd/acl.d/luci-app-frpc-advanced.json').read_text())['luci-app-frpc-advanced']
assert not acl['read'].get('uci')
assert set(acl['write']['uci']['frpc-advanced']) == {'read', 'write'}
assert '/etc/init.d/frpc-advanced' not in acl['read']['file']
restricted = {'get_config', 'get_config_compare', 'get_version'}
assert restricted.isdisjoint(acl['read']['ubus']['luci.frpc-advanced'])
assert {'get_version', 'get_config_compare'} <= set(acl['write']['ubus']['luci.frpc-advanced'])
assert 'get_config: {' not in rpc
print('FRPC security policy static checks passed')
