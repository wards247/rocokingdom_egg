(async function () {
    // ==================== 全局数据容器 ====================
    let petIds = [];
    let petNames = [];
    let eggGroups = [];
    let evolvesFromId = [];
    let petTags = [];               // 合并后的标签：special_tags + has_shiny
    // 普通/异色分离存储（索引 -> 数量）
    let femaleNormal = [];
    let femaleShiny = [];
    let maleNormal = [];
    let maleShiny = [];
    let femaleCheckboxStates = [];
    let maleCheckboxStates = [];
    let compatibleMap = new Map();
    let groupNames = {};
    let specialTagNames = {};
    let seasonNames = {};

    let modalType = null;
    let modalTempCounts = null;          // 普通数量（临时）
    let modalTempShinyCounts = null;     // 异色数量（临时）
    let modalSavedCounts = null;
    let modalSavedShinyCounts = null;
    let modalSavedCheckboxStates = null;
    let modalMaxFemales = 0;
    let modalSearchResults = [];
    const evolutionChainCache = new Map();

    // ==================== 数据加载 ====================
    async function loadPetsJSON() {
        try {
            const resp = await fetch('./data/pets.json?t=' + Date.now());
            if (!resp.ok) throw new Error('pets.json 加载失败');
            const pets = await resp.json();
            petIds = pets.map(p => p.id);
            petNames = pets.map(p => p.name);
            eggGroups = pets.map(p => p.egg_groups || []);
            evolvesFromId = pets.map(p => p.evolves_from_id ?? null);
            petTags = pets.map(p => {
                const tags = [...(p.special_tags || [])];
                if (p.has_shiny !== null && typeof p.has_shiny === 'number') {
                    tags.push(p.has_shiny);
                }
                return tags;
            });
            buildCompatibilityMap();
            resetCounters();
            await loadDefinitions();
            refreshUI();
            return true;
        } catch (err) {
            console.warn('加载 pets.json 失败，使用内置数据:', err);
            return false;
        }
    }

    async function loadDefinitions() {
        try {
            const resp = await fetch('./data/defines.json?t=' + Date.now());
            if (resp.ok) {
                const defs = await resp.json();
                if (defs.egg_groups) Object.assign(groupNames, defs.egg_groups);
                if (defs.season) {
                    Object.assign(seasonNames, defs.season);
                    Object.assign(specialTagNames, defs.season);
                }
                if (defs.special_tags) Object.assign(specialTagNames, defs.special_tags);
            }
        } catch (e) {
            for (let i = 1; i <= 15; i++) groupNames[i] = i;
        }
        if (!specialTagNames[1001]) specialTagNames[1001] = '只有雄性';
        if (!specialTagNames[1002]) specialTagNames[1002] = '只有雌性';
    }

    function buildCompatibilityMap() {
        compatibleMap.clear();
        const n = petIds.length;
        for (let i = 0; i < n; i++) compatibleMap.set(i, new Set());
        for (let i = 0; i < n; i++) {
            if (eggGroups[i].length === 0 || isNonBreedable(i)) continue;
            compatibleMap.get(i).add(i);
            for (let j = i + 1; j < n; j++) {
                if (eggGroups[j].length === 0 || isNonBreedable(j)) continue;
                if (hasCommonGroup(eggGroups[i], eggGroups[j])) {
                    compatibleMap.get(i).add(j);
                    compatibleMap.get(j).add(i);
                }
            }
        }
    }

    function hasCommonGroup(g1, g2) {
        for (const g of g1) if (g2.includes(g)) return true;
        return false;
    }

    function isNonBreedable(idx) {
        return eggGroups[idx].includes(1) || petTags[idx].includes(300);
    }

    function resetCounters() {
        const n = petIds.length;
        femaleNormal = new Array(n).fill(0);
        femaleShiny = new Array(n).fill(0);
        maleNormal = new Array(n).fill(0);
        maleShiny = new Array(n).fill(0);
        femaleCheckboxStates = new Array(n).fill(false);
        maleCheckboxStates = new Array(n).fill(false);
    }

    function buildDefaultData() {
        petIds = [3081, 3011, 3151];
        petNames = ['治愈兔', '恶魔狼', '多多'];
        eggGroups = [[6, 7], [6], [9]];
        evolvesFromId = [null, null, null];
        petTags = [[101], [100], [100]];
        groupNames = { 6: '动物组', 7: '妖精组', 9: '拟人组' };
        seasonNames = { 101: 'S1 暗夜拾光', 102: 'S2 狂欢怪谈' };
        specialTagNames = { ...seasonNames, 1001: '只有雄性', 1002: '只有雌性' };
        buildCompatibilityMap();
        resetCounters();
        refreshUI();
    }

    // ==================== 进化链查找 ====================
    function getEvolutionChain(indices) {
        const resultSet = new Set();
        for (const idx of indices) {
            if (eggGroups[idx].length === 0) continue;
            if (evolutionChainCache.has(idx)) {
                for (const i of evolutionChainCache.get(idx)) resultSet.add(i);
            } else {
                const chain = new Set();
                let current = idx;
                while (current !== null && current !== undefined) {
                    chain.add(current);
                    const parentId = evolvesFromId[current];
                    if (parentId === null) break;
                    current = petIds.indexOf(parentId);
                    if (current === -1) break;
                }
                const toProcess = [...chain];
                const processed = new Set(chain);
                while (toProcess.length > 0) {
                    const cur = toProcess.pop();
                    const curId = petIds[cur];
                    for (let i = 0; i < petIds.length; i++) {
                        if (processed.has(i)) continue;
                        if (evolvesFromId[i] === curId) {
                            chain.add(i);
                            processed.add(i);
                            toProcess.push(i);
                        }
                    }
                }
                evolutionChainCache.set(idx, chain);
                for (const i of chain) resultSet.add(i);
            }
        }
        return Array.from(resultSet).filter(i => eggGroups[i].length > 0);
    }

    // ==================== UI 辅助 ====================
    const CIRCLED_NUMS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];
    function getDisplayName(species, instanceIdx, totalSame) {
        if (totalSame > 1) {
            const num = instanceIdx < CIRCLED_NUMS.length ? CIRCLED_NUMS[instanceIdx] : `(${instanceIdx + 1})`;
            return `${petNames[species]}${num}`;
        }
        return petNames[species];
    }

    function getNestTotal() { return Math.max(1, Math.min(10, parseInt(nestCountInput.value) || 10)); }
    function getMaxFemales() { return Math.max(0, getNestTotal() - 1); }
    function getFemaleTotal() { return femaleNormal.reduce((a, b) => a + b, 0) + femaleShiny.reduce((a, b) => a + b, 0); }
    function getMaleStockTotal() { return maleNormal.reduce((a, b) => a + b, 0) + maleShiny.reduce((a, b) => a + b, 0); }

    function refreshUI() {
        const maxF = getMaxFemales();
        const fTotal = getFemaleTotal();
        const mTotal = getMaleStockTotal();
        maxFemaleDisplay.textContent = maxF;
        capacityHint.textContent = maxF > 0 ? `最多放${maxF}只雌性·至少1个雄性窝` : '需至少2个窝';
        femaleTotalBadge.textContent = `总数: ${fTotal} / ${maxF}`;
        maleTotalBadge.textContent = `库存: ${mTotal} 只`;
        if (fTotal > maxF) {
            femaleLimitWarn.textContent = `⚠️ 超出上限！请减少至${maxF}只`;
            femaleTotalBadge.classList.add('warn');
        } else {
            femaleLimitWarn.textContent = '';
            femaleTotalBadge.classList.remove('warn');
        }
        updateSelectedDisplays();
    }

    function updateSelectedDisplays() {
        femaleSelectedDisplay.innerHTML = '';
        let hasFemale = false;
        petNames.forEach((_, idx) => {
            // 显示普通雌性
            if (femaleNormal[idx] > 0) {
                hasFemale = true;
                const tag = createPetTag(idx, 'female', false, femaleNormal[idx]);
                femaleSelectedDisplay.appendChild(tag);
            }
            // 显示异色雌性
            if (femaleShiny[idx] > 0) {
                hasFemale = true;
                const tag = createPetTag(idx, 'female', true, femaleShiny[idx]);
                femaleSelectedDisplay.appendChild(tag);
            }
        });
        if (!hasFemale) femaleSelectedDisplay.innerHTML = '<span class="empty-hint">暂未选择</span>';

        maleSelectedDisplay.innerHTML = '';
        let hasMale = false;
        petNames.forEach((_, idx) => {
            if (maleNormal[idx] > 0) {
                hasMale = true;
                const tag = createPetTag(idx, 'male', false, maleNormal[idx]);
                maleSelectedDisplay.appendChild(tag);
            }
            if (maleShiny[idx] > 0) {
                hasMale = true;
                const tag = createPetTag(idx, 'male', true, maleShiny[idx]);
                maleSelectedDisplay.appendChild(tag);
            }
        });
        if (!hasMale) maleSelectedDisplay.innerHTML = '<span class="empty-hint">暂未选择</span>';

        document.querySelectorAll('.tag-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.dataset.petIndex);
                const isShiny = btn.dataset.shiny === 'true';
                if (btn.dataset.type === 'female') {
                    if (isShiny) {
                        femaleShiny[idx] = 0;
                    } else {
                        femaleNormal[idx] = 0;
                    }
                    femaleCheckboxStates[idx] = (femaleNormal[idx] + femaleShiny[idx] > 0);
                } else {
                    if (isShiny) {
                        maleShiny[idx] = 0;
                    } else {
                        maleNormal[idx] = 0;
                    }
                    maleCheckboxStates[idx] = (maleNormal[idx] + maleShiny[idx] > 0);
                }
                refreshUI();
            });
        });
    }

    function createPetTag(idx, type, isShiny, qty) {
        const tag = document.createElement('span');
        tag.className = 'pet-tag ' + (type === 'female' ? 'female-tag' : 'male-tag');
        let prefix = type === 'female' ? '♀' : '♂';
        if (isShiny) prefix = '⭐ ' + prefix;   // 标注“⭐”
        tag.innerHTML = `<span>${prefix} ${petNames[idx]}</span><span class="tag-qty">×${qty}</span><button class="tag-remove" data-pet-index="${idx}" data-type="${type}" data-shiny="${isShiny}">✕</button>`;
        tag.addEventListener('click', (e) => {
            if (e.target.closest('.tag-remove')) return;
            startInlineEdit(tag, idx, type, isShiny);
        });
        return tag;
    }

    function startInlineEdit(tag, idx, type, isShiny) {
        const qtySpan = tag.querySelector('.tag-qty');
        if (!qtySpan) return;
        const currentVal = type === 'female'
            ? (isShiny ? femaleShiny[idx] : femaleNormal[idx])
            : (isShiny ? maleShiny[idx] : maleNormal[idx]);
        const input = document.createElement('input');
        input.type = 'number';
        input.min = 0;
        input.max = 99;
        input.value = currentVal;
        input.className = 'qty-edit-input';
        qtySpan.replaceWith(input);
        input.focus();
        input.select();

        const finish = () => {
            let newVal = Math.max(0, parseInt(input.value) || 0);
            if (type === 'female') {
                const maxF = getMaxFemales();
                const currentTotal = getFemaleTotal();
                const other = currentTotal - currentVal;
                newVal = Math.min(newVal, maxF - other);
                if (isShiny) {
                    femaleShiny[idx] = newVal;
                } else {
                    femaleNormal[idx] = newVal;
                }
                femaleCheckboxStates[idx] = (femaleNormal[idx] + femaleShiny[idx] > 0);
            } else {
                if (isShiny) {
                    maleShiny[idx] = newVal;
                } else {
                    maleNormal[idx] = newVal;
                }
                maleCheckboxStates[idx] = (maleNormal[idx] + maleShiny[idx] > 0);
            }
            refreshUI();
        };

        input.addEventListener('blur', finish);
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                input.blur();
            }
        });
    }

    // ==================== DOM 元素 ====================
    const nestCountInput = document.getElementById('nestCount');
    const femaleTotalBadge = document.getElementById('femaleTotalBadge');
    const maleTotalBadge = document.getElementById('maleTotalBadge');
    const femaleLimitWarn = document.getElementById('femaleLimitWarn');
    const maxFemaleDisplay = document.getElementById('maxFemaleDisplay');
    const capacityHint = document.getElementById('capacityHint');
    const globalMsg = document.getElementById('globalMsg');
    const resultArea = document.getElementById('resultArea');
    const nestVisualDiv = document.getElementById('nestVisual');
    const maleDetailsDiv = document.getElementById('maleDetails');
    const coverageSummaryDiv = document.getElementById('coverageSummary');
    const generateBtn = document.getElementById('generateBtn');
    const resetBtn = document.getElementById('resetBtn');
    const exportBtn = document.getElementById('exportBtn');
    const placementBtn = document.getElementById('placementBtn');
    const placementArea = document.getElementById('placementArea');
    const svgContainer = document.getElementById('svgContainer');
    const exportPlacementBtn = document.getElementById('exportPlacementBtn');
    const femaleSelectedDisplay = document.getElementById('femaleSelectedDisplay');
    const maleSelectedDisplay = document.getElementById('maleSelectedDisplay');
    const openFemaleModalBtn = document.getElementById('openFemaleModalBtn');
    const openMaleModalBtn = document.getElementById('openMaleModalBtn');
    const clearFemaleBtn = document.getElementById('clearFemaleBtn');
    const clearMaleBtn = document.getElementById('clearMaleBtn');
    const modalOverlay = document.getElementById('modalOverlay');
    const modalTitle = document.getElementById('modalTitle');
    const modalCloseBtn = document.getElementById('modalCloseBtn');
    const modalCancel = document.getElementById('modalCancel');
    const modalConfirm = document.getElementById('modalConfirm');
    const searchBox = document.getElementById('searchBox');
    const groupFilter = document.getElementById('groupFilter');
    const seasonFilter = document.getElementById('seasonFilter');

    // ==================== 模态框与搜索 ====================
    function populateFilters() {
        groupFilter.innerHTML = '<option value="">点击选择蛋组</option>';
        for (const [id, name] of Object.entries(groupNames)) {
            const option = document.createElement('option');
            option.value = id;
            option.textContent = name;
            groupFilter.appendChild(option);
        }
        seasonFilter.innerHTML = '<option value="">点击选择赛季异色</option>';
        for (const [id, name] of Object.entries(seasonNames)) {
            const option = document.createElement('option');
            option.value = id;
            option.textContent = name;
            seasonFilter.appendChild(option);
        }
    }

    function renderSearchResults(results) {
        const container = document.getElementById('searchResults');
        container.innerHTML = '';
        if (results.length === 0) {
            container.innerHTML = '<div style="text-align:center;color:#999;">无匹配精灵</div>';
            return;
        }
        results.sort((a, b) => petIds[a] - petIds[b]);
        for (const idx of results) {
            const div = document.createElement('div');
            div.className = 'search-result-item';
            const isHatchable = !isNonBreedable(idx);
            const left = document.createElement('div');
            left.className = 'left-info';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'pet-name';
            nameSpan.textContent = petNames[idx];
            left.appendChild(nameSpan);

            // 性别限制标签
            if (petTags[idx].includes(1001)) {
                const tag = document.createElement('span');
                tag.style.cssText = 'color:#2c3e50; font-size:0.65rem; background:#dce6f5; border-radius:8px; padding:1px 6px; margin-left:6px;';
                tag.textContent = '仅雄性';
                left.appendChild(tag);
            }
            if (petTags[idx].includes(1002)) {
                const tag = document.createElement('span');
                tag.style.cssText = 'color:#2c3e50; font-size:0.65rem; background:#fde8e8; border-radius:8px; padding:1px 6px; margin-left:6px;';
                tag.textContent = '仅雌性';
                left.appendChild(tag);
            }

            if (!isHatchable) {
                const badSpan = document.createElement('span');
                badSpan.style.cssText = 'color:#d9534f; font-size:0.8rem; margin-left:6px;';
                badSpan.textContent = '🚫不可孵蛋';
                left.appendChild(badSpan);
            }

            const qtyRow = document.createElement('div');
            qtyRow.style.cssText = 'display: flex; align-items: center; gap: 12px; margin-top: 8px;';

            const maxLimit = modalType === 'female' ? modalMaxFemales : 99;
            const seasonTags = petTags[idx].filter(t => seasonNames[t]);

            // 普通数量控件
            const normalDiv = document.createElement('div');
            normalDiv.className = 'qty-ctrl';
            const btnMinus = document.createElement('button'); btnMinus.textContent = '−';
            const qtyInput = document.createElement('input'); qtyInput.type = 'number';
            qtyInput.min = 0; qtyInput.max = maxLimit; qtyInput.step = 1;
            qtyInput.value = modalTempCounts[idx] || 0;
            if (!isHatchable) { qtyInput.disabled = true; btnMinus.disabled = true; }
            const btnPlus = document.createElement('button'); btnPlus.textContent = '+';
            if (!isHatchable) btnPlus.disabled = true;

            const updateQty = (newVal) => {
                if (!isHatchable) return;
                let val = Math.max(0, parseInt(newVal) || 0);
                if (modalType === 'female') {
                    const currentTotal = Object.values(modalTempCounts).reduce((s, v) => s + v, 0)
                        + Object.values(modalTempShinyCounts).reduce((s, v) => s + v, 0);
                    const other = currentTotal - (modalTempCounts[idx] || 0) - (modalTempShinyCounts[idx] || 0);
                    val = Math.min(val, modalMaxFemales - other);
                }
                modalTempCounts[idx] = val;
                qtyInput.value = val;
            };
            btnMinus.addEventListener('click', () => updateQty((modalTempCounts[idx] || 0) - 1));
            btnPlus.addEventListener('click', () => updateQty((modalTempCounts[idx] || 0) + 1));
            qtyInput.addEventListener('change', () => updateQty(parseInt(qtyInput.value) || 0));
            normalDiv.appendChild(btnMinus);
            normalDiv.appendChild(qtyInput);
            normalDiv.appendChild(btnPlus);
            qtyRow.appendChild(normalDiv);

            // 异色数量控件（有赛季标签时显示，并添加边框）
            if (seasonTags.length > 0) {
                const shinyBox = document.createElement('div');
                shinyBox.style.cssText = 'border: 2px solid #e6a317; border-radius: 10px; padding: 4px 8px; display: flex; flex-direction: column; align-items: center; background: #fffdf5;';

                const shinyDiv = document.createElement('div');
                shinyDiv.className = 'qty-ctrl';
                const sMinus = document.createElement('button'); sMinus.textContent = '−';
                const sInput = document.createElement('input'); sInput.type = 'number';
                sInput.min = 0; sInput.max = maxLimit; sInput.step = 1;
                sInput.value = modalTempShinyCounts[idx] || 0;
                if (!isHatchable) { sInput.disabled = true; sMinus.disabled = true; }
                const sPlus = document.createElement('button'); sPlus.textContent = '+';
                if (!isHatchable) sPlus.disabled = true;

                const updateShiny = (newVal) => {
                    if (!isHatchable) return;
                    let val = Math.max(0, parseInt(newVal) || 0);
                    if (modalType === 'female') {
                        const currentTotal = Object.values(modalTempCounts).reduce((s, v) => s + v, 0)
                            + Object.values(modalTempShinyCounts).reduce((s, v) => s + v, 0);
                        const other = currentTotal - (modalTempCounts[idx] || 0) - (modalTempShinyCounts[idx] || 0);
                        val = Math.min(val, modalMaxFemales - other);
                    }
                    modalTempShinyCounts[idx] = val;
                    sInput.value = val;
                };
                sMinus.addEventListener('click', () => updateShiny((modalTempShinyCounts[idx] || 0) - 1));
                sPlus.addEventListener('click', () => updateShiny((modalTempShinyCounts[idx] || 0) + 1));
                sInput.addEventListener('change', () => updateShiny(parseInt(sInput.value) || 0));
                shinyDiv.appendChild(sMinus);
                shinyDiv.appendChild(sInput);
                shinyDiv.appendChild(sPlus);
                shinyBox.appendChild(shinyDiv);

                const seasonBadge = document.createElement('span');
                seasonBadge.style.cssText = 'font-size:0.6rem; color:#b06030; margin-top:2px;';
                seasonBadge.textContent = seasonTags.map(t => seasonNames[t]).join('/');
                shinyBox.appendChild(seasonBadge);

                qtyRow.appendChild(shinyBox);
            }

            left.appendChild(qtyRow);
            div.appendChild(left);

            const groupsDiv = document.createElement('div');
            groupsDiv.className = 'groups';
            for (const g of eggGroups[idx]) {
                const badge = document.createElement('span');
                badge.className = 'group-badge';
                badge.textContent = groupNames[g] || g;
                groupsDiv.appendChild(badge);
            }
            div.appendChild(groupsDiv);
            container.appendChild(div);
        }
    }

    function performFilteredSearch(keyword) {
        const groupVal = groupFilter.value ? parseInt(groupFilter.value) : null;
        const seasonVal = seasonFilter.value ? parseInt(seasonFilter.value) : null;
        const lowerKeyword = keyword.trim().toLowerCase();

        const candidates = [];
        for (let i = 0; i < petIds.length; i++) {
            if (eggGroups[i].length === 0) continue;
            if (modalType === 'female' && petTags[i].includes(1001)) continue;
            if (modalType === 'male' && petTags[i].includes(1002)) continue;
            if (groupVal !== null && !eggGroups[i].includes(groupVal)) continue;
            if (seasonVal !== null && !petTags[i].includes(seasonVal)) continue;
            if (lowerKeyword && !petNames[i].toLowerCase().includes(lowerKeyword)) continue;
            candidates.push(i);
        }

        if (groupVal === null && seasonVal === null && !lowerKeyword) {
            document.getElementById('searchResults').innerHTML = '';
            modalSearchResults = [];
            return;
        }

        const chainIndices = getEvolutionChain(candidates);
        const filtered = chainIndices.filter(i => {
            if (eggGroups[i].length === 0) return false;
            if (modalType === 'female' && petTags[i].includes(1001)) return false;
            if (modalType === 'male' && petTags[i].includes(1002)) return false;
            if (groupVal !== null && !eggGroups[i].includes(groupVal)) return false;
            if (seasonVal !== null && !petTags[i].includes(seasonVal)) return false;
            return true;
        });

        modalSearchResults = filtered;
        renderSearchResults(filtered);
    }

    function openModal(type) {
        modalType = type;
        modalMaxFemales = getMaxFemales();
        const n = petIds.length;
        if (type === 'female') {
            modalSavedCounts = [...femaleNormal];
            modalSavedShinyCounts = [...femaleShiny];
            modalSavedCheckboxStates = [...femaleCheckboxStates];
            modalTempCounts = [...femaleNormal];
            modalTempShinyCounts = new Array(n).fill(0);
            // 恢复已有异色数量
            for (let i = 0; i < n; i++) modalTempShinyCounts[i] = femaleShiny[i];
        } else {
            modalSavedCounts = [...maleNormal];
            modalSavedShinyCounts = [...maleShiny];
            modalSavedCheckboxStates = [...maleCheckboxStates];
            modalTempCounts = [...maleNormal];
            modalTempShinyCounts = new Array(n).fill(0);
            for (let i = 0; i < n; i++) modalTempShinyCounts[i] = maleShiny[i];
        }
        modalTitle.innerHTML = type === 'female'
            ? `🌸 选择雌性精灵 <span style="font-size:0.8rem;">(上限${modalMaxFemales}只)</span>`
            : '♂️ 选择雄性精灵（库存）';
        document.getElementById('petSearchInput').value = '';
        document.getElementById('searchResults').innerHTML = '';
        modalSearchResults = [];

        populateFilters();
        groupFilter.value = '';
        seasonFilter.value = '';

        modalOverlay.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        nestCountInput.disabled = true;
    }

    function closeModal(confirmed) {
        if (confirmed && modalType) {
            const n = petIds.length;
            if (modalType === 'female') {
                for (let i = 0; i < n; i++) {
                    femaleNormal[i] = modalTempCounts[i] || 0;
                    femaleShiny[i] = modalTempShinyCounts[i] || 0;
                    femaleCheckboxStates[i] = (femaleNormal[i] + femaleShiny[i] > 0);
                }
            } else {
                for (let i = 0; i < n; i++) {
                    maleNormal[i] = modalTempCounts[i] || 0;
                    maleShiny[i] = modalTempShinyCounts[i] || 0;
                    maleCheckboxStates[i] = (maleNormal[i] + maleShiny[i] > 0);
                }
            }
        }
        modalType = null;
        modalTempCounts = null;
        modalTempShinyCounts = null;
        modalOverlay.style.display = 'none';
        document.body.style.overflow = '';
        nestCountInput.disabled = false;
        searchBox.style.display = 'flex';
        refreshUI();
    }

    function cancelModal() { closeModal(false); }

    // ==================== 事件绑定 ====================
    clearFemaleBtn.addEventListener('click', () => {
        femaleNormal.fill(0); femaleShiny.fill(0);
        femaleCheckboxStates.fill(false);
        refreshUI();
    });
    clearMaleBtn.addEventListener('click', () => {
        maleNormal.fill(0); maleShiny.fill(0);
        maleCheckboxStates.fill(false);
        refreshUI();
    });
    modalCloseBtn.addEventListener('click', cancelModal);
    modalCancel.addEventListener('click', cancelModal);
    modalConfirm.addEventListener('click', () => closeModal(true));
    modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) cancelModal(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && modalOverlay.style.display === 'flex') cancelModal(); });
    openFemaleModalBtn.addEventListener('click', () => openModal('female'));
    openMaleModalBtn.addEventListener('click', () => openModal('male'));

    groupFilter.addEventListener('change', () => performFilteredSearch(document.getElementById('petSearchInput').value));
    seasonFilter.addEventListener('change', () => performFilteredSearch(document.getElementById('petSearchInput').value));

    document.getElementById('resetFiltersBtn').addEventListener('click', () => {
        groupFilter.value = '';
        seasonFilter.value = '';
        document.getElementById('petSearchInput').value = '';
        performFilteredSearch('');
    });

    document.getElementById('searchBtn').addEventListener('click', () => performFilteredSearch(document.getElementById('petSearchInput').value));
    document.getElementById('petSearchInput').addEventListener('keypress', (e) => { if (e.key === 'Enter') performFilteredSearch(e.target.value); });

    // ==================== 配窝推荐算法 ====================
    let lastResultData = null;
    const GRID_SIZE = 7;
    let currentPlacement = { maleCoords: [], femaleCoords: [], maleSlots: [], femaleInstances: [] };
    let originalPlacement = null;

    function calcUniquePairs(femaleInstances, maleSlots) {
        maleSlots.forEach(m => { m.lockedForIds = []; m.locked = false; });
        femaleInstances.forEach(fi => {
            const compatibleMaleIndices = [];
            maleSlots.forEach((m, idx) => { if (compatibleMap.get(m.species).has(fi.species)) compatibleMaleIndices.push(idx); });
            if (compatibleMaleIndices.length === 1) {
                const maleIdx = compatibleMaleIndices[0];
                maleSlots[maleIdx].lockedForIds.push(fi.id);
                maleSlots[maleIdx].locked = true;
            }
        });
    }

    function computeRecommendation() {
    const nestTotal = getNestTotal();
    const femaleInstances = [];
    femaleNormal.forEach((cnt, sp) => {
        for (let i = 0; i < cnt; i++) femaleInstances.push({ species: sp, id: `f-${sp}-${i}`, isShiny: false });
    });
    femaleShiny.forEach((cnt, sp) => {
        for (let i = 0; i < cnt; i++) femaleInstances.push({ species: sp, id: `fs-${sp}-${i}`, isShiny: true });
    });

    const requiredMales = nestTotal - femaleInstances.length;
    if (requiredMales <= 0) return { error: '雌性已占满所有窝，请留至少一个雄性窝。' };

    // 分开普通和异色库存
    const stockNormal = new Map();
    const stockShiny = new Map();
    maleNormal.forEach((cnt, idx) => { if (cnt > 0) stockNormal.set(idx, cnt); });
    maleShiny.forEach((cnt, idx) => { if (cnt > 0) stockShiny.set(idx, cnt); });

    const totalStock = new Map();
    stockNormal.forEach((cnt, idx) => totalStock.set(idx, (totalStock.get(idx) || 0) + cnt));
    stockShiny.forEach((cnt, idx) => totalStock.set(idx, (totalStock.get(idx) || 0) + cnt));
    if (totalStock.size === 0) return { error: '雄性库存为空。' };

    const consumeMale = (species) => {
        if (stockNormal.get(species) > 0) {
            stockNormal.set(species, stockNormal.get(species) - 1);
            totalStock.set(species, totalStock.get(species) - 1);
            return { species, isShiny: false };
        } else if (stockShiny.get(species) > 0) {
            stockShiny.set(species, stockShiny.get(species) - 1);
            totalStock.set(species, totalStock.get(species) - 1);
            return { species, isShiny: true };
        }
        return null;
    };

    const maleLimit = new Map();
    for (const [mSp] of totalStock) {
        maleLimit.set(mSp, femaleInstances.filter(f => compatibleMap.get(mSp).has(f.species)).length);
    }

    const femaleDeps = femaleInstances.map(f => {
        const possible = [];
        for (const [mSp, cnt] of totalStock) {
            if (compatibleMap.get(mSp).has(f.species) && cnt > 0) possible.push(mSp);
        }
        return { female: f, possible };
    });

    // 预留唯一依赖
    const reservedPairs = [], reservedMales = new Set(), lockedFemaleIds = new Set();
    const uniqueDeps = femaleDeps.filter(d => d.possible.length === 1 && totalStock.get(d.possible[0]) === 1);
    const usedUnique = new Set();
    for (const dep of uniqueDeps) {
        const mSp = dep.possible[0];
        if (usedUnique.has(mSp)) continue;
        if (totalStock.get(mSp) >= 1) {
            const male = consumeMale(mSp);
            if (!male) continue;
            reservedPairs.push({ femaleId: dep.female.id, maleSpecies: mSp, isShiny: male.isShiny });
            reservedMales.add(mSp);
            usedUnique.add(mSp);
            lockedFemaleIds.add(dep.female.id);
        }
    }

    // 截断修复
    if (reservedPairs.length > requiredMales) {
        const maleCoverCount = new Map();
        for (const [mSp] of totalStock) {
            maleCoverCount.set(mSp, femaleInstances.filter(f => compatibleMap.get(mSp).has(f.species)).length);
        }
        reservedPairs.sort((a, b) => (maleCoverCount.get(a.maleSpecies) || 0) - (maleCoverCount.get(b.maleSpecies) || 0));
        const removedPairs = reservedPairs.splice(requiredMales);
        for (const rp of removedPairs) {
            lockedFemaleIds.delete(rp.femaleId);
            reservedMales.delete(rp.maleSpecies);
            if (rp.isShiny) {
                stockShiny.set(rp.maleSpecies, (stockShiny.get(rp.maleSpecies) || 0) + 1);
            } else {
                stockNormal.set(rp.maleSpecies, (stockNormal.get(rp.maleSpecies) || 0) + 1);
            }
            totalStock.set(rp.maleSpecies, (totalStock.get(rp.maleSpecies) || 0) + 1);
        }
    }

    const remainingSlots = requiredMales - reservedPairs.length;
    const selectedExtra = [];
    const uncoveredFemaleIds = new Set(femaleInstances.map(f => f.id));
    reservedPairs.forEach(rp => {
        const comp = compatibleMap.get(rp.maleSpecies);
        femaleInstances.forEach(f => { if (comp.has(f.species)) uncoveredFemaleIds.delete(f.id); });
    });

    // 贪心选择
    for (let i = 0; i < remainingSlots; i++) {
        let bestSp = -1, bestNew = -1, bestTotal = -1;
        for (const [mSp, cnt] of totalStock) {
            if (cnt <= 0) continue;
            const curCnt = reservedPairs.filter(r => r.maleSpecies === mSp).length + selectedExtra.filter(s => s.species === mSp).length;
            if (curCnt >= (maleLimit.get(mSp) || 0)) continue;
            const comp = compatibleMap.get(mSp);
            let newC = 0, total = 0;
            femaleInstances.forEach(f => { if (comp.has(f.species)) { total++; if (uncoveredFemaleIds.has(f.id)) newC++; } });
            if (newC > bestNew || (newC === bestNew && total > bestTotal)) { bestNew = newC; bestTotal = total; bestSp = mSp; }
        }
        if (bestSp === -1) break;
        const male = consumeMale(bestSp);
        if (!male) break;
        selectedExtra.push(male);
        const cov = compatibleMap.get(bestSp);
        femaleInstances.forEach(f => { if (cov.has(f.species)) uncoveredFemaleIds.delete(f.id); });
    }

    while (selectedExtra.length < remainingSlots && totalStock.size > 0) {
        let bestSp = -1, bestTotal = -1;
        for (const [mSp, cnt] of totalStock) {
            if (cnt <= 0) continue;
            const curCnt = reservedPairs.filter(r => r.maleSpecies === mSp).length + selectedExtra.filter(s => s.species === mSp).length;
            if (curCnt >= (maleLimit.get(mSp) || 0)) continue;
            let total = 0;
            const comp = compatibleMap.get(mSp);
            femaleInstances.forEach(f => { if (comp.has(f.species)) total++; });
            if (total > bestTotal) { bestTotal = total; bestSp = mSp; }
        }
        if (bestSp === -1) break;
        const male = consumeMale(bestSp);
        if (!male) break;
        selectedExtra.push(male);
    }

    let allMaleSlots = reservedPairs.map(rp => ({ species: rp.maleSpecies, locked: true, lockedForIds: [], isShiny: rp.isShiny }));
    selectedExtra.forEach(m => allMaleSlots.push({ species: m.species, locked: false, lockedForIds: [], isShiny: m.isShiny }));

    const optimized = ensureHallCondition(femaleInstances, allMaleSlots);
    const finalMaleSlots = optimized.map(m => ({ ...m, lockedForIds: [] }));
    const emptySlots = requiredMales - finalMaleSlots.length;

    calcUniquePairs(femaleInstances, finalMaleSlots);

    const coveredFemaleIds = new Set();
    finalMaleSlots.forEach(m => {
        const comp = compatibleMap.get(m.species);
        femaleInstances.forEach(f => { if (comp.has(f.species)) coveredFemaleIds.add(f.id); });
    });
    const uncoveredFemales = femaleInstances.filter(f => !coveredFemaleIds.has(f.id));

    // ★ 关键修改：coveredIds 使用物种索引和异色标记
    const maleCoverDetails = finalMaleSlots.map(m => {
        const comp = compatibleMap.get(m.species);
        const covered = femaleInstances.filter(f => comp.has(f.species));
        return {
            species: m.species,
            locked: m.locked,
            lockedForIds: m.lockedForIds,
            isShiny: m.isShiny,
            coveredNames: covered.map(f => petNames[f.species]),
            coveredIds: covered.map(f => ({ id: f.species, isShiny: f.isShiny }))
        };
    });

    return { femaleInstances, allMaleSlots: finalMaleSlots, emptySlots, uncoveredFemales, maleCoverDetails };
}

    function maxMatching(females, maleList) {
        const n = maleList.length;
        const adj = Array.from({ length: n }, () => []);
        maleList.forEach((m, i) => {
            const comp = compatibleMap.get(m.species);
            females.forEach((f, j) => { if (comp.has(f.species)) adj[i].push(j); });
        });
        const matchR = Array(females.length).fill(-1);
        let result = 0;
        const seen = new Array(females.length);
        function dfs(u) {
            for (const v of adj[u]) {
                if (seen[v]) continue;
                seen[v] = true;
                if (matchR[v] === -1 || dfs(matchR[v])) { matchR[v] = u; return true; }
            }
            return false;
        }
        for (let u = 0; u < n; u++) { seen.fill(false); if (dfs(u)) result++; }
        return result;
    }

    function ensureHallCondition(females, maleSlots) {
        const males = maleSlots.map((m, i) => ({ ...m, origIdx: i }));
        while (males.length > 0) {
            if (maxMatching(females, males) === males.length) break;
            let worstIdx = -1, worstCover = Infinity;
            for (let i = 0; i < males.length; i++) {
                if (males[i].locked) continue;
                const cover = females.filter(f => compatibleMap.get(males[i].species).has(f.species)).length;
                if (cover < worstCover) { worstCover = cover; worstIdx = i; }
            }
            if (worstIdx === -1) worstIdx = males.length - 1;
            males.splice(worstIdx, 1);
        }
        return males;
    }

    function renderResult(result) {
    if (result.error) {
        globalMsg.innerHTML = `<div class="warning">${result.error}</div>`;
        resultArea.style.display = 'none';
        placementArea.style.display = 'none';
        placementBtn.style.display = 'none';
        return;
    }
    globalMsg.innerHTML = '';
    resultArea.style.display = 'block';
    placementBtn.style.display = 'inline-flex';
    const { femaleInstances, allMaleSlots, emptySlots, uncoveredFemales, maleCoverDetails } = result;
    const femaleSpeciesIdx = {};
    femaleInstances.forEach(f => {
        if (!femaleSpeciesIdx[f.species]) femaleSpeciesIdx[f.species] = [];
        femaleSpeciesIdx[f.species].push(f);
    });
    const maleSpeciesIdx = {};
    allMaleSlots.forEach((m, i) => {
        if (!maleSpeciesIdx[m.species]) maleSpeciesIdx[m.species] = [];
        maleSpeciesIdx[m.species].push({ ...m, inst: i });
    });
    nestVisualDiv.innerHTML = '';
    const uncoveredIds = new Set(uncoveredFemales.map(f => f.id));

    femaleInstances.forEach(f => {
        const total = femaleSpeciesIdx[f.species].length,
              idx = femaleSpeciesIdx[f.species].indexOf(f);
        const div = document.createElement('div');
        div.className = 'nest-item female';
        div.style.position = 'relative';
        div.innerHTML = `<span class="icon">♀️</span><span>${getDisplayName(f.species, idx, total)}</span>`;

        if (f.isShiny) {
            const star = document.createElement('span');
            star.style.cssText = 'position:absolute; top:-4px; right:2px; font-size:1.2rem; color:#e6a317; text-shadow:0 0 4px gold;';
            star.textContent = '⭐';
            div.appendChild(star);
        }

        if (uncoveredIds.has(f.id)) {
            const overlay = document.createElement('span');
            overlay.style.cssText = 'position:absolute; top:0; left:0; right:0; bottom:0; display:flex; align-items:center; justify-content:center; background: rgba(255,100,100,0.35); border-radius: 20px; z-index:1;';
            const icon = document.createElement('span');
            icon.style.cssText = 'font-size:2.5rem; font-weight:bold; color: rgba(221, 21, 204, 0.45); text-shadow: 0 0 8px white; line-height:1; transform: translateY(-12px);';
            icon.textContent = '⚠️';
            overlay.appendChild(icon);
            div.appendChild(overlay);
        }

        nestVisualDiv.appendChild(div);
    });

    allMaleSlots.forEach((m, i) => {
        const total = maleSpeciesIdx[m.species].length,
              info = maleSpeciesIdx[m.species].find(x => x.inst === i);
        const idx = info ? maleSpeciesIdx[m.species].indexOf(info) : 0;
        const div = document.createElement('div');
        div.className = 'nest-item male';
        div.style.position = 'relative';
        div.innerHTML = `<span class="icon">${m.locked ? '🔒♂️' : '♂️'}</span><span>${getDisplayName(m.species, idx, total)}</span>`;

        if (m.isShiny) {
            const star = document.createElement('span');
            star.style.cssText = 'position:absolute; top:-4px; right:2px; font-size:1.2rem; color:#e6a317; text-shadow:0 0 4px gold;';
            star.textContent = '⭐';
            div.appendChild(star);
        }

        nestVisualDiv.appendChild(div);
    });

    for (let i = 0; i < emptySlots; i++) {
        const div = document.createElement('div'); div.className = 'nest-item male'; div.style.opacity = '0.5';
        div.innerHTML = '<span class="icon">♂️</span><span>(空窝)</span>';
        nestVisualDiv.appendChild(div);
    }

    maleDetailsDiv.innerHTML = '';
    maleCoverDetails.forEach((md, i) => {
        const total = maleSpeciesIdx[md.species].length,
              info = maleSpeciesIdx[md.species].find(x => x.inst === i);
        const idx = info ? maleSpeciesIdx[md.species].indexOf(info) : 0;
        const card = document.createElement('div'); card.className = 'male-card';
        const lockedNames = (md.lockedForIds || []).map(id => petNames[parseInt(id.split('-')[1])]).join('、');
        const lockBadge = lockedNames ? `<span style="color:#b06030;font-weight:700;">🔒 唯一依赖·专属配对：${lockedNames}</span>` : '';

        // ★ 使用新的 coveredIds 结构（{id: species, isShiny}）
        const coveredEntries = (md.coveredIds || []).map(c => {
            const name = petNames[c.id] || `?`;
            return { name, isShiny: c.isShiny };
        });
        const tags = coveredEntries.map(e => `<span class="tag">${e.name}${e.isShiny ? '⭐' : ''}</span>`).join(' ');
        const groups = eggGroups[md.species].map(g => groupNames[g] || g).join('/');
        const maleStar = md.isShiny ? '⭐' : '';

        card.innerHTML = `
            <div class="card-header">
                <strong>♂ ${getDisplayName(md.species, idx, total)}${maleStar}</strong>
                <span class="egg-groups">${groups}</span>
            </div>
            <div>(窝${femaleInstances.length + i + 1}) ${lockBadge}</div>
            <div style="font-size:0.8rem;">可配雌性：${tags || '<span style="color:#999;">无</span>'}</div>
        `;
        maleDetailsDiv.appendChild(card);
    });

    let summary = '';
    if (uncoveredFemales.length > 0) summary += `<span style="color:#b34a4a;">⚠️ 以下雌性无法被覆盖：${uncoveredFemales.map(f => petNames[f.species]).join('、')}</span><br>`;
    else summary += `<span style="color:#2d5a27;">✅ 所有雌性均已覆盖！</span><br>`;
    if (emptySlots > 0) summary += `<span style="color:#ab6d2a;">📌 为防止雄性闲置，自动少放${emptySlots}只雄性。</span><br>`;
    coverageSummaryDiv.innerHTML = summary;
}

    function doGenerate() {
        if (getFemaleTotal() === 0) { globalMsg.innerHTML = '<div class="warning">🌸 请至少选择一只雌性。</div>'; return; }
        if (getFemaleTotal() > getMaxFemales()) { globalMsg.innerHTML = '<div class="warning">雌性数量超过上限。</div>'; return; }
        if (getMaleStockTotal() === 0) { globalMsg.innerHTML = '<div class="warning">♂️ 请至少添加雄性。</div>'; return; }
        const result = computeRecommendation();
        lastResultData = result;
        renderResult(result);
        placementArea.style.display = 'none';
    }

    function exportToImage() {
        if (resultArea.style.display === 'none') return;
        html2canvas(resultContent, { backgroundColor: '#faf3e8', scale: 2 }).then(canvas => {
            const a = document.createElement('a'); a.download = '配窝方案.png'; a.href = canvas.toDataURL(); a.click();
        });
    }

    // ==================== 位置图生成 ====================
    function generatePlacement() {
    if (!lastResultData || lastResultData.error) return;
    const res = lastResultData;
    const originalFemaleInstances = res.femaleInstances;
    const uncoveredFemales = res.uncoveredFemales;

    const uncoveredIds = new Set(uncoveredFemales.map(f => f.id));
    const coveredFemaleInstances = originalFemaleInstances.filter(f => !uncoveredIds.has(f.id));

    if (coveredFemaleInstances.length === 0) {
        globalMsg.innerHTML = '<div class="warning">没有雌性可被覆盖，无法生成位置图。</div>';
        return;
    }

    const maleSlots = res.allMaleSlots;
    const males = maleSlots.map((sm, idx) => ({ id: `m-${idx}`, species: sm.species, idx }));

    const maleCompatCount = new Array(males.length).fill(0);
    coveredFemaleInstances.forEach(fi => {
        males.forEach(m => {
            if (compatibleMap.get(m.species).has(fi.species)) maleCompatCount[m.idx]++;
        });
    });

    const maleUniqueCount = new Array(males.length).fill(0);
    coveredFemaleInstances.forEach(fi => {
        const compatibleMaleIndices = [];
        males.forEach(m => {
            if (compatibleMap.get(m.species).has(fi.species)) compatibleMaleIndices.push(m.idx);
        });
        if (compatibleMaleIndices.length === 1) maleUniqueCount[compatibleMaleIndices[0]]++;
    });

    const buildNearbyTargets = (level) => males.map((_, mi) => maleCompatCount[mi] >= 4 ? Math.min(level, maleCompatCount[mi]) : 0);

    const createFemales = (strictMode) => coveredFemaleInstances.map((fi, idx) => {
        const fMales = [];
        males.forEach(m => {
            if (compatibleMap.get(m.species).has(fi.species)) fMales.push(m.idx);
        });
        if (fMales.length === 0) return null;
        const stepLimit = Math.min(fMales.length, 2);
        const constraints = fMales.map(mi => {
            // 基础距离限制
            let minDist = 1;
            let maxDist = stepLimit;

            const isUniqueDep = (fMales.length === 1 && fMales[0] === mi);
            // 应用用户规则：唯一依赖放宽至2，非唯一依赖且雄性可配≥4放宽至4
            if (isUniqueDep) {
                maxDist = Math.max(maxDist, 2);
            } else if (maleCompatCount[mi] >= 4) {
                maxDist = Math.max(maxDist, 4);
            }

            // 原有代码中针对 maleHasUniqueDep 的 minDist 调整（保留以维持兼容，但非用户要求）
            // 注意：若需要完全遵循用户规则，可以注释掉以下逻辑，但为保证其他约束正常，保留
            const maleHasUniqueDep = maleUniqueCount[mi] > 0;
            if (maleHasUniqueDep && !isUniqueDep) {
                minDist = Math.max(minDist, 2);
            }

            return { maleIdx: mi, minDist, maxDist };
        });
        return { id: fi.id, species: fi.species, males: fMales, stepLimit, constraints, idx, isShiny: fi.isShiny };
    }).filter(f => f !== null);

    let best = null, bestArea = Infinity, found = 0;
    const total = coveredFemaleInstances.length + maleSlots.length;
    const strategyList = [{ strict: true, level: 3 }, { strict: true, level: 2 }, { strict: false, level: 3 }, { strict: false, level: 2 }];

    for (const strategy of strategyList) {
        const targets = buildNearbyTargets(strategy.level);
        const fem = createFemales(strategy.strict);
        for (let t = 0; t < 200 && found < (total > 7 ? 3 : 1); t++) {
            let pl = solvePlacement(fem, males, targets, maleCompatCount, maleUniqueCount);
            if (pl) {
                pl = compactPlacement(pl); found++;
                let minX = GRID_SIZE, maxX = 0, minY = GRID_SIZE, maxY = 0;
                pl.maleCoords.forEach(c => { minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x); minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y); });
                pl.femaleCoords.forEach(c => { minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x); minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y); });
                const area = (maxX - minX + 1) * (maxY - minY + 1);
                if (area < bestArea) { bestArea = area; best = pl; }
            }
        }
        if (best) break;
    }

    if (!best) return;
    best = compactPlacement(best);
    best = centerPlacement(best);
    currentPlacement = {
        maleCoords: best.maleCoords,
        femaleCoords: best.femaleCoords,
        maleSlots: maleSlots,
        femaleInstances: coveredFemaleInstances
    };
    originalPlacement = {
        maleCoords: best.maleCoords.map(c => ({ ...c })),
        femaleCoords: best.femaleCoords.map(c => ({ ...c }))
    };
    placementArea.style.display = 'block';
    renderSVG();
}

    function compactPlacement(pl) {
        if (!pl || (pl.maleCoords.length === 0 && pl.femaleCoords.length === 0)) return pl;
        const all = [...pl.maleCoords, ...pl.femaleCoords];
        const minX = Math.min(...all.map(c => c.x)), minY = Math.min(...all.map(c => c.y));
        return { maleCoords: pl.maleCoords.map(c => ({ x: c.x - minX, y: c.y - minY })), femaleCoords: pl.femaleCoords.map(c => ({ x: c.x - minX, y: c.y - minY })) };
    }

    function centerPlacement(pl) {
        if (!pl || (pl.maleCoords.length === 0 && pl.femaleCoords.length === 0)) return pl;
        const all = [...pl.maleCoords, ...pl.femaleCoords];
        const minX = Math.min(...all.map(c => c.x)), maxX = Math.max(...all.map(c => c.x));
        const minY = Math.min(...all.map(c => c.y)), maxY = Math.max(...all.map(c => c.y));
        const w = maxX - minX + 1, h = maxY - minY + 1;
        const offX = Math.floor((GRID_SIZE - w) / 2) - minX, offY = Math.floor((GRID_SIZE - h) / 2) - minY;
        return { maleCoords: pl.maleCoords.map(c => ({ x: c.x + offX, y: c.y + offY })), femaleCoords: pl.femaleCoords.map(c => ({ x: c.x + offX, y: c.y + offY })) };
    }

    function solvePlacement(females, males, maleNearbyTargets, maleCompatCount, maleUniqueCount) {
    const M = males.length;
    const GRID_SIZE = 7;

    // 辅助函数：检查雄性当前放置后，未放置的雌性是否仍有可能满足目标
    function canStillMeetTargets(placedFemales, remainingFemales, maleCoords, malesArr, targets) {
        for (let mi = 0; mi < malesArr.length; mi++) {
            const target = targets[mi];
            if (target > 0) {
                let currentNearby = 0;
                for (const fi of placedFemales) {
                    const dist = Math.abs(fi.coord.x - maleCoords[mi].x) + Math.abs(fi.coord.y - maleCoords[mi].y);
                    if (dist <= 2 && compatibleMap.get(malesArr[mi].species).has(fi.species)) currentNearby++;
                }
                let potentialMax = 0;
                for (const fi of remainingFemales) if (compatibleMap.get(malesArr[mi].species).has(fi.species)) potentialMax++;
                if (currentNearby + potentialMax < target) return false;
            }
        }
        return true;
    }

    // 回溯放置雌性
    function tryPlace(sorted, start, occupied, maleCoords) {
        if (start >= sorted.length) {
            return true;
        }
        const f = sorted[start];
        const cand = [];
        for (let y = 0; y < GRID_SIZE; y++) {
            for (let x = 0; x < GRID_SIZE; x++) {
                const key = y * GRID_SIZE + x;
                if (occupied.has(key)) continue;
                let ok = true;
                for (const c of f.constraints) {
                    const mx = maleCoords[c.maleIdx].x, my = maleCoords[c.maleIdx].y;
                    const dist = Math.abs(x - mx) + Math.abs(y - my);
                    if (dist < c.minDist || dist > c.maxDist) { ok = false; break; }
                }
                if (ok) cand.push({ x, y });
            }
        }
        if (cand.length === 0) return false;
        // 按距离总和排序（优先靠近雄性）
        cand.sort((a, b) => {
            const dA = f.constraints.reduce((s, c) => s + Math.abs(a.x - maleCoords[c.maleIdx].x) + Math.abs(a.y - maleCoords[c.maleIdx].y), 0);
            const dB = f.constraints.reduce((s, c) => s + Math.abs(b.x - maleCoords[c.maleIdx].x) + Math.abs(b.y - maleCoords[c.maleIdx].y), 0);
            return dA - dB;
        });
        for (const p of cand) {
            const key = p.y * GRID_SIZE + p.x;
            occupied.add(key);
            f.coord = p;
            const placed = sorted.slice(0, start + 1);
            const remaining = sorted.slice(start + 1);
            if (canStillMeetTargets(placed, remaining, maleCoords, males, maleNearbyTargets) && tryPlace(sorted, start + 1, occupied, maleCoords)) {
                return true;
            }
            occupied.delete(key);
        }
        return false;
    }

    // ========== 智能生成雄性初始坐标 ==========
    // 如果雄性数量较少（≤2），优先选择中心区域，否则完全随机
    const useCenterBias = (M <= 2);
    const centerPositions = [];
    for (let y = 2; y <= 4; y++) {
        for (let x = 2; x <= 4; x++) {
            centerPositions.push({ x, y });
        }
    }

    for (let att = 0; att < 3000; att++) {
        const maleCoords = new Array(M);
        const occupied = new Set();
        let fail = false;

        // 按唯一依赖数量排序，让有唯一依赖的雄性优先放置（但这里只决定顺序，位置仍需选择）
        const indices = [...Array(M).keys()].sort((a, b) => {
            const aU = maleUniqueCount[a] > 0, bU = maleUniqueCount[b] > 0;
            if (aU !== bU) return aU ? 1 : -1;
            if (aU) return maleCompatCount[b] - maleCompatCount[a];
            return maleCompatCount[a] - maleCompatCount[b];
        });

        for (const mi of indices) {
            let x, y;
            let tries = 0;
            // 若使用中心偏置且当前雄性有唯一依赖或可配雌性多，优先从中心区域选取
            if (useCenterBias && (maleUniqueCount[mi] > 0 || maleCompatCount[mi] >= 4)) {
                // 从中心区域随机选一个未被占用的格子
                const availableCenters = centerPositions.filter(p => !occupied.has(p.y * GRID_SIZE + p.x));
                if (availableCenters.length > 0) {
                    const rand = Math.floor(Math.random() * availableCenters.length);
                    x = availableCenters[rand].x;
                    y = availableCenters[rand].y;
                } else {
                    // 中心全被占，回退到全局随机
                    do { x = Math.floor(Math.random() * GRID_SIZE); y = Math.floor(Math.random() * GRID_SIZE); tries++; } while (occupied.has(y * GRID_SIZE + x) && tries < 100);
                }
            } else {
                do { x = Math.floor(Math.random() * GRID_SIZE); y = Math.floor(Math.random() * GRID_SIZE); tries++; } while (occupied.has(y * GRID_SIZE + x) && tries < 100);
            }
            if (tries >= 100) { fail = true; break; }
            occupied.add(y * GRID_SIZE + x);
            maleCoords[mi] = { x, y };
        }
        if (fail) continue;

        // 雌性排序：唯一依赖优先，然后按可选雄性数、步长等排序
        const malePositionOrder = new Array(M);
        indices.forEach((mi, pos) => { malePositionOrder[mi] = pos; });
        const sorted = [...females].sort((a, b) => {
            const aU = a.males.length === 1, bU = b.males.length === 1;
            if (aU !== bU) return aU ? 1 : -1;
            if (aU) return malePositionOrder[a.males[0]] - malePositionOrder[b.males[0]];
            if (a.stepLimit !== b.stepLimit) return a.stepLimit - b.stepLimit;
            if (a.males.length !== b.males.length) return a.males.length - b.males.length;
            const minA = Math.min(...a.males.map(mi => maleCompatCount[mi]));
            const minB = Math.min(...b.males.map(mi => maleCompatCount[mi]));
            return minA - minB;
        });

        const occCopy = new Set(occupied);
        if (tryPlace(sorted, 0, occCopy, maleCoords)) {
            // 将坐标写回 females 数组
            sorted.forEach(f => {
                const orig = females.find(e => e.id === f.id);
                if (orig) orig.coord = f.coord;
            });
            return { maleCoords, femaleCoords: females.map(f => f.coord) };
        }
    }
    return null;
}

    function findNearestFreePosition(targetX, targetY, occupiedSet, gridSize, maxDist = 4) {
        const key = targetY * gridSize + targetX;
        if (!occupiedSet.has(key)) return { x: targetX, y: targetY };
        const queue = [{ x: targetX, y: targetY, dist: 0 }], visited = new Set([key]);
        const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
        for (let head = 0; head < queue.length; head++) {
            const { x, y, dist } = queue[head];
            if (dist >= maxDist) continue;
            for (const [dx, dy] of dirs) {
                const nx = x + dx, ny = y + dy;
                if (nx < 0 || nx >= gridSize || ny < 0 || ny >= gridSize) continue;
                const nk = ny * gridSize + nx;
                if (visited.has(nk)) continue;
                visited.add(nk);
                if (!occupiedSet.has(nk)) return { x: nx, y: ny };
                queue.push({ x: nx, y: ny, dist: dist + 1 });
            }
        }
        return null;
    }

    function renderSVG() {
        svgContainer.innerHTML = '';
        const scale = 60, gridSize = GRID_SIZE, width = gridSize * scale, height = gridSize * scale;
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        svg.style.width = '100%'; svg.style.height = 'auto';
        svg.style.touchAction = 'none'; svg.style.userSelect = 'none'; svg.style.webkitUserSelect = 'none';
        for (let i = 0; i <= gridSize; i++) {
            const lh = document.createElementNS('http://www.w3.org/2000/svg', 'line'); lh.setAttribute('x1', 0); lh.setAttribute('y1', i * scale); lh.setAttribute('x2', width); lh.setAttribute('y2', i * scale); lh.setAttribute('stroke', '#d4b68c'); lh.setAttribute('stroke-width', '1'); svg.appendChild(lh);
            const lv = document.createElementNS('http://www.w3.org/2000/svg', 'line'); lv.setAttribute('x1', i * scale); lv.setAttribute('y1', 0); lv.setAttribute('x2', i * scale); lv.setAttribute('y2', height); lv.setAttribute('stroke', '#d4b68c'); lv.setAttribute('stroke-width', '1'); svg.appendChild(lv);
        }
        const linesGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g'); svg.appendChild(linesGroup);
        const squaresGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g'); svg.appendChild(squaresGroup);
        function toSvgX(x) { return x * scale; } function toSvgY(y) { return y * scale; }
        function drawLines() {
            linesGroup.innerHTML = '';
            const { maleCoords, femaleCoords, maleSlots, femaleInstances } = currentPlacement;
            const lines = [];
            maleCoords.forEach((mc, mi) => {
                const comp = compatibleMap.get(maleSlots[mi].species), lockedIds = maleSlots[mi].lockedForIds || [];
                femaleCoords.forEach((fc, fi) => {
                    if (!comp.has(femaleInstances[fi].species)) return;
                    const dist = Math.abs(mc.x - fc.x) + Math.abs(mc.y - fc.y);
                    if (dist > 2) return;
                    lines.push({ mi, fi, dist, isLocked: lockedIds.includes(femaleInstances[fi].id) });
                });
            });
            const minDistMap = new Map();
            lines.forEach(l => { if (!l.isLocked && (!minDistMap.has(l.mi) || l.dist < minDistMap.get(l.mi))) minDistMap.set(l.mi, l.dist); });
            lines.forEach(l => {
                const from = maleCoords[l.mi], to = femaleCoords[l.fi];
                const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line.setAttribute('x1', toSvgX(from.x) + scale / 2); line.setAttribute('y1', toSvgY(from.y) + scale / 2);
                line.setAttribute('x2', toSvgX(to.x) + scale / 2); line.setAttribute('y2', toSvgY(to.y) + scale / 2);
                if (l.isLocked) { line.setAttribute('stroke', '#d44'); line.setAttribute('stroke-width', '3'); }
                else if (l.dist === minDistMap.get(l.mi)) { line.setAttribute('stroke', '#4a8'); line.setAttribute('stroke-width', '2.5'); }
                else { line.setAttribute('stroke', '#aaa'); line.setAttribute('stroke-width', '2'); }
                line.setAttribute('opacity', '0.7');
                linesGroup.appendChild(line);
            });
        }
        function drawSquares() {
    squaresGroup.innerHTML = '';
    const { maleCoords, femaleCoords, maleSlots, femaleInstances } = currentPlacement;

    // 绘制雌性方格
    femaleCoords.forEach((coord, i) => {
        const fi = femaleInstances[i];
        if (!fi) return; // 安全保护
        const cx = toSvgX(coord.x) + scale / 2,
              cy = toSvgY(coord.y) + scale / 2;

        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', toSvgX(coord.x) + 2);
        rect.setAttribute('y', toSvgY(coord.y) + 2);
        rect.setAttribute('width', scale - 4);
        rect.setAttribute('height', scale - 4);
        rect.setAttribute('fill', 'rgba(248,200,200,0.8)');
        rect.setAttribute('stroke', '#d89b9b');
        rect.setAttribute('stroke-width', '2');
        rect.setAttribute('rx', '6');
        rect.classList.add('female-square');
        rect.dataset.type = 'female';
        rect.dataset.index = i;
        squaresGroup.appendChild(rect);

        // 图标
        const iconText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        iconText.setAttribute('x', cx);
        iconText.setAttribute('y', cy - 7);
        iconText.setAttribute('text-anchor', 'middle');
        iconText.setAttribute('fill', '#8b3a3a');
        iconText.setAttribute('font-size', '14');
        iconText.textContent = '♀️';
        iconText.setAttribute('pointer-events', 'none');
        iconText.style.userSelect = 'none';
        squaresGroup.appendChild(iconText);

        // 名字
        const nameText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        nameText.setAttribute('x', cx);
        nameText.setAttribute('y', cy + 11);
        nameText.setAttribute('text-anchor', 'middle');
        nameText.setAttribute('fill', '#8b3a3a');
        nameText.setAttribute('font-size', '10');
        nameText.textContent = getDisplayName(
            fi.species,
            i,
            femaleInstances.filter(f => f.species === fi.species).length
        );
        nameText.setAttribute('pointer-events', 'none');
        nameText.style.userSelect = 'none';
        squaresGroup.appendChild(nameText);

        // 异色星星
        if (fi.isShiny) {
            const star = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            star.setAttribute('x', cx + scale / 2 - 8);
            star.setAttribute('y', cy - scale / 2 + 14);
            star.setAttribute('text-anchor', 'middle');
            star.setAttribute('fill', '#e6a317');
            star.setAttribute('font-size', '14');
            star.setAttribute('font-weight', 'bold');
            star.textContent = '⭐';
            star.setAttribute('pointer-events', 'none');
            squaresGroup.appendChild(star);
        }
    });

    // 绘制雄性方格
    maleCoords.forEach((coord, i) => {
        const ms = maleSlots[i];
        if (!ms) return;
        const cx = toSvgX(coord.x) + scale / 2,
              cy = toSvgY(coord.y) + scale / 2;

        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', toSvgX(coord.x) + 2);
        rect.setAttribute('y', toSvgY(coord.y) + 2);
        rect.setAttribute('width', scale - 4);
        rect.setAttribute('height', scale - 4);
        rect.setAttribute('fill', 'rgba(200,220,240,0.8)');
        rect.setAttribute('stroke', '#7a9bcb');
        rect.setAttribute('stroke-width', '2');
        rect.setAttribute('rx', '6');
        rect.classList.add('male-square');
        rect.dataset.type = 'male';
        rect.dataset.index = i;
        squaresGroup.appendChild(rect);

        const iconText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        iconText.setAttribute('x', cx);
        iconText.setAttribute('y', cy - 7);
        iconText.setAttribute('text-anchor', 'middle');
        iconText.setAttribute('fill', '#2c3e50');
        iconText.setAttribute('font-size', '14');
        iconText.textContent = ms.locked ? '🔒♂️' : '♂️';
        iconText.setAttribute('pointer-events', 'none');
        iconText.style.userSelect = 'none';
        squaresGroup.appendChild(iconText);

        const nameText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        nameText.setAttribute('x', cx);
        nameText.setAttribute('y', cy + 11);
        nameText.setAttribute('text-anchor', 'middle');
        nameText.setAttribute('fill', '#2c3e50');
        nameText.setAttribute('font-size', '10');
        nameText.textContent = getDisplayName(
            ms.species,
            i,
            maleSlots.filter(m => m.species === ms.species).length
        );
        nameText.setAttribute('pointer-events', 'none');
        nameText.style.userSelect = 'none';
        squaresGroup.appendChild(nameText);

        // 异色星星
        if (ms.isShiny) {
            const star = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            star.setAttribute('x', cx + scale / 2 - 8);
            star.setAttribute('y', cy - scale / 2 + 14);
            star.setAttribute('text-anchor', 'middle');
            star.setAttribute('fill', '#e6a317');
            star.setAttribute('font-size', '14');
            star.setAttribute('font-weight', 'bold');
            star.textContent = '⭐';
            star.setAttribute('pointer-events', 'none');
            squaresGroup.appendChild(star);
        }
    });

    attachDragEvents();
}
        function attachDragEvents() {
            const draggableElements = svg.querySelectorAll('.female-square, .male-square');
            let dragTarget = null, originalCoord = null, startClientX = 0, startClientY = 0;
            function onStart(e, type, index) {
                e.preventDefault();
                const clientX = e.touches ? e.touches[0].clientX : e.clientX, clientY = e.touches ? e.touches[0].clientY : e.clientY;
                dragTarget = { type, index };
                const points = type === 'female' ? currentPlacement.femaleCoords : currentPlacement.maleCoords;
                originalCoord = { ...points[index] }; startClientX = clientX; startClientY = clientY;
                svg.querySelectorAll('.female-square, .male-square').forEach(sq => sq.classList.remove('dragging'));
                const targetSelector = type === 'female' ? `.female-square[data-index="${index}"]` : `.male-square[data-index="${index}"]`;
                const targetEl = svg.querySelector(targetSelector);
                if (targetEl) targetEl.classList.add('dragging');
                window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onEnd);
                window.addEventListener('touchmove', onMove, { passive: false }); window.addEventListener('touchend', onEnd);
            }
            function onMove(e) {
                if (!dragTarget) return; e.preventDefault();
                const clientX = e.touches ? e.touches[0].clientX : e.clientX, clientY = e.touches ? e.touches[0].clientY : e.clientY;
                const svgRect = svg.getBoundingClientRect(), scaleX = svgRect.width / width, scaleY = svgRect.height / height;
                const dx = (clientX - startClientX) / (scale * scaleX), dy = (clientY - startClientY) / (scale * scaleY);
                const gridDX = Math.round(dx), gridDY = Math.round(dy);
                let desiredX = originalCoord.x + gridDX, desiredY = originalCoord.y + gridDY;
                desiredX = Math.max(0, Math.min(gridSize - 1, desiredX)); desiredY = Math.max(0, Math.min(gridSize - 1, desiredY));
                const allPoints = [...currentPlacement.maleCoords, ...currentPlacement.femaleCoords];
                const targetAllIndex = dragTarget.type === 'female' ? currentPlacement.maleCoords.length + dragTarget.index : dragTarget.index;
                const occupiedSet = new Set(); allPoints.forEach((p, i) => { if (i !== targetAllIndex) occupiedSet.add(p.y * gridSize + p.x); });
                const freePos = findNearestFreePosition(desiredX, desiredY, occupiedSet, gridSize, 5);
                if (freePos) {
                    const points = dragTarget.type === 'female' ? currentPlacement.femaleCoords : currentPlacement.maleCoords;
                    const oldCoord = points[dragTarget.index];
                    if (oldCoord.x !== freePos.x || oldCoord.y !== freePos.y) {
                        points[dragTarget.index] = { x: freePos.x, y: freePos.y };
                        if (freePos.x !== desiredX || freePos.y !== desiredY) { originalCoord = { x: freePos.x, y: freePos.y }; startClientX = clientX; startClientY = clientY; }
                        drawSquares(); drawLines();
                    }
                }
            }
            function onEnd() {
                if (dragTarget) svg.querySelectorAll('.female-square, .male-square').forEach(sq => sq.classList.remove('dragging'));
                dragTarget = null; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onEnd);
                window.removeEventListener('touchmove', onMove); window.removeEventListener('touchend', onEnd);
            }
            draggableElements.forEach(el => {
                el.addEventListener('mousedown', (e) => onStart(e, el.dataset.type, parseInt(el.dataset.index)));
                el.addEventListener('touchstart', (e) => onStart(e, el.dataset.type, parseInt(el.dataset.index)), { passive: false });
            });
        }
        drawSquares(); drawLines(); svgContainer.appendChild(svg);
    }

    function exportPlacementImage() {
        if (placementArea.style.display === 'none') return;
        html2canvas(svgContainer, { backgroundColor: '#faf3e8', scale: 2 }).then(canvas => {
            const a = document.createElement('a'); a.download = '配窝位置图.png'; a.href = canvas.toDataURL(); a.click();
        });
    }

    // ==================== 按钮事件 ====================
    generateBtn.addEventListener('click', doGenerate);
    resetBtn.addEventListener('click', () => {
        femaleNormal.fill(0); femaleShiny.fill(0);
        maleNormal.fill(0); maleShiny.fill(0);
        femaleCheckboxStates.fill(false); maleCheckboxStates.fill(false);
        nestCountInput.value = 10; nestCountInput.disabled = false;
        resultArea.style.display = 'none'; placementArea.style.display = 'none'; placementBtn.style.display = 'none';
        globalMsg.innerHTML = ''; lastResultData = null;
        if (modalOverlay.style.display === 'flex') { modalOverlay.style.display = 'none'; document.body.style.overflow = ''; }
        refreshUI();
    });
    exportBtn.addEventListener('click', exportToImage);
    placementBtn.addEventListener('click', generatePlacement);
    exportPlacementBtn.addEventListener('click', exportPlacementImage);
    nestCountInput.addEventListener('input', refreshUI);
    nestCountInput.addEventListener('change', refreshUI);

    // ==================== 配置导入/导出 ====================
    function exportConfig() {
        const config = {
            nestCount: getNestTotal(),
            females: [],
            males: []
        };
        for (let i = 0; i < petIds.length; i++) {
            if (femaleNormal[i] > 0) config.females.push({ id: petIds[i], name: petNames[i], count: femaleNormal[i], shiny: false });
            if (femaleShiny[i] > 0) config.females.push({ id: petIds[i], name: petNames[i], count: femaleShiny[i], shiny: true });
            if (maleNormal[i] > 0) config.males.push({ id: petIds[i], name: petNames[i], count: maleNormal[i], shiny: false });
            if (maleShiny[i] > 0) config.males.push({ id: petIds[i], name: petNames[i], count: maleShiny[i], shiny: true });
        }
        const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = '配窝配置.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function importConfig(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const config = JSON.parse(e.target.result);
                // 清空现有数据
                femaleNormal.fill(0); femaleShiny.fill(0);
                maleNormal.fill(0); maleShiny.fill(0);
                femaleCheckboxStates.fill(false); maleCheckboxStates.fill(false);

                if (typeof config.nestCount === 'number' && config.nestCount >= 1 && config.nestCount <= 10) {
                    nestCountInput.value = config.nestCount;
                }

                const idToIndex = new Map();
                petIds.forEach((id, idx) => idToIndex.set(id, idx));

                if (Array.isArray(config.females)) {
                    for (const f of config.females) {
                        const idx = idToIndex.get(f.id);
                        if (idx !== undefined && typeof f.count === 'number' && f.count > 0) {
                            const maxF = getMaxFemales();
                            const currentTotal = getFemaleTotal();
                            const allowed = Math.min(f.count, maxF - currentTotal);
                            if (allowed > 0) {
                                if (f.shiny) {
                                    femaleShiny[idx] = allowed;
                                } else {
                                    femaleNormal[idx] = allowed;
                                }
                                femaleCheckboxStates[idx] = true;
                            }
                        }
                    }
                }
                if (Array.isArray(config.males)) {
                    for (const m of config.males) {
                        const idx = idToIndex.get(m.id);
                        if (idx !== undefined && typeof m.count === 'number' && m.count > 0) {
                            if (m.shiny) {
                                maleShiny[idx] = m.count;
                            } else {
                                maleNormal[idx] = m.count;
                            }
                            maleCheckboxStates[idx] = true;
                        }
                    }
                }

                refreshUI();
                globalMsg.innerHTML = '<div class="info">✅ 配置已成功导入</div>';
            } catch (err) {
                globalMsg.innerHTML = '<div class="warning">❌ 配置文件格式错误</div>';
            }
        };
        reader.readAsText(file);
    }

    document.getElementById('exportConfigBtn').addEventListener('click', exportConfig);
    document.getElementById('importConfigBtn').addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (file) importConfig(file);
        };
        input.click();
    });

    // 启动
    const loaded = await loadPetsJSON();
    if (!loaded) buildDefaultData();
})();
