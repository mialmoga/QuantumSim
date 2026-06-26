/**
 * panels.js
 * UI panel logic: tab toggles, collapse behavior.
 * Extracted from inline <script> in index.html.
 *
 * Called from app.js after DOM is ready (inside init()).
 */

/**
 * Initialize the Molecules / Crystals tab toggle inside the Add Panel.
 */
export function initAddPanelTabs() {
    const btnMolecules  = document.getElementById('showMolecules');
    const btnCrystals   = document.getElementById('showCrystals');
    const btnSnowflake  = document.getElementById('showSnowflake');

    const secMolecules  = document.getElementById('moleculesSection');
    const secCrystals   = document.getElementById('crystalsSection');
    const secSnowflake  = document.getElementById('snowflakeSection');

    if(!btnMolecules || !btnCrystals) return;

    const tabs     = [btnMolecules,  btnCrystals,  btnSnowflake ].filter(Boolean);
    const sections = [secMolecules,  secCrystals,  secSnowflake ].filter(Boolean);

    function activateTab(activeBtn) {
        tabs.forEach((btn, i) => {
            const isActive = btn === activeBtn;
            btn.classList.toggle('add-panel__tab--active',   isActive);
            btn.classList.toggle('add-panel__tab--inactive', !isActive);
            if(sections[i]) sections[i].classList.toggle('hidden', !isActive);
        });
    }

    tabs.forEach(btn => btn.addEventListener('click', () => activateTab(btn)));
}
