// Load the browser scripts into Node; they attach themselves to globalThis.Riki.
for (const f of ['cards', 'rules', 'game', 'ai']) require(`../js/${f}.js`);
module.exports = globalThis.Riki;
