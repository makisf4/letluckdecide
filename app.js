// State machine for letluckdecide.com with data tree navigation
// TODO: Add wheel canvas/SVG implementation
// TODO: Add food and fun tree structures
// TODO: Enhance decide logic animations

import { DATA, ROOT_CATEGORIES } from './data.js';
import { RECIPES } from './recipes.js';

// Constants
const RECENT_LIMIT = 20;

// State
let state = {
    categoryId: null,   // "travel" | "food" | "fun"
    nodeId: null,       // current node id μέσα στο tree
    path: [],           // array από { nodeId, label }
    pendingResult: null, // {id, label} όταν τρέχει το εφέ
    lastResult: null    // μόνο όταν ολοκληρωθεί το εφέ (τελικό)
};

// DOM elements
const wheelContainer = document.getElementById("wheel");
const breadcrumbsContainer = document.getElementById("breadcrumbs");
const backBtn = document.getElementById("backBtn");
const decideBtn = document.getElementById("decideBtn");
const homeBtn = document.getElementById("homeBtn");
const resultContainer = document.getElementById("result");
const affiliatePanel = document.getElementById("affiliatePanel");
const transitionOverlay = document.getElementById("transitionOverlay");
const resultActions = document.getElementById("resultActions");
const replayBtn = document.getElementById("replayBtn");
const recipeBtn = document.getElementById("recipeBtn");
const recipeModal = document.getElementById("recipeModal");
const recipeTitle = document.getElementById("recipeTitle");
const recipeMeta = document.getElementById("recipeMeta");
const recipeIngredients = document.getElementById("recipeIngredients");
const recipeSteps = document.getElementById("recipeSteps");
const recipeTipsWrap = document.getElementById("recipeTipsWrap");
const recipeTips = document.getElementById("recipeTips");
const recipeCopyBtn = document.getElementById("recipeCopyBtn");

// Store current recipe copy text
let currentRecipeCopyText = "";

// Check if desktop viewport
function isDesktop() {
    return window.matchMedia("(min-width: 1024px)").matches;
}

// Helper: Get node from DATA
function getNode(categoryId, nodeId) {
    if (!categoryId || !nodeId || !DATA[categoryId]) {
        return null;
    }
    return DATA[categoryId][nodeId] || null;
}

// Helper: Check if node is leaf (has pool)
function isLeaf(node) {
    return node && node.pool && Array.isArray(node.pool);
}

// Helper: Crypto-based random index (0 to max-1)
function cryptoPickIndex(max) {
    if (max <= 0) return 0;
    const array = new Uint32Array(1);
    crypto.getRandomValues(array);
    return array[0] % max;
}

// localStorage helpers for anti-repeat
function loadRecent() {
    try {
        return JSON.parse(localStorage.getItem("lld_recent") || "{}");
    } catch {
        return {};
    }
}

function saveRecent(obj) {
    localStorage.setItem("lld_recent", JSON.stringify(obj));
}

function pushRecent(leafNodeId, itemId) {
    const recent = loadRecent();
    const arr = Array.isArray(recent[leafNodeId]) ? recent[leafNodeId] : [];
    const next = [itemId, ...arr.filter(x => x !== itemId)].slice(0, RECENT_LIMIT);
    recent[leafNodeId] = next;
    saveRecent(recent);
}

function pickFromPoolAvoidingRecent(leafNodeId, poolItems) {
    // poolItems: [{id,label}]
    const recent = loadRecent();
    const avoid = new Set(Array.isArray(recent[leafNodeId]) ? recent[leafNodeId] : []);

    // προσπάθεια 1: απέφυγε όλα τα recent
    let candidates = poolItems.filter(it => !avoid.has(it.id));

    // αν λίγοι/κανένας, χαλάρωσε σταδιακά
    if (candidates.length < Math.min(8, poolItems.length)) {
        // χαλάρωση: κράτα μόνο τα πρώτα 10 recent να αποφεύγονται
        const avoid10 = new Set((recent[leafNodeId] || []).slice(0, 10));
        candidates = poolItems.filter(it => !avoid10.has(it.id));
    }
    if (candidates.length < Math.min(6, poolItems.length)) {
        // χαλάρωση: απέφυγε μόνο τα πρώτα 5
        const avoid5 = new Set((recent[leafNodeId] || []).slice(0, 5));
        candidates = poolItems.filter(it => !avoid5.has(it.id));
    }
    if (candidates.length === 0) candidates = poolItems;

    const idx = cryptoPickIndex(candidates.length);
    return candidates[idx];
}

// Helper: Random walk from a node to a leaf, building path
function walkToLeaf(categoryId, startNodeId) {
    const path = [];
    let currentNodeId = startNodeId;
    
    while (true) {
        const node = getNode(categoryId, currentNodeId);
        if (!node) break;
        
        path.push({ nodeId: currentNodeId, label: node.label });
        
        if (isLeaf(node)) {
            return { nodeId: currentNodeId, path };
        }
        
        if (node.children && node.children.length > 0) {
            const randomIndex = cryptoPickIndex(node.children.length);
            currentNodeId = node.children[randomIndex];
        } else {
            break;
        }
    }
    
    return { nodeId: currentNodeId, path };
}

// Get root category labels
function getRootOptions() {
    return Object.values(ROOT_CATEGORIES);
}

// Last animation style used (for anti-repeat)
let lastAnimStyle = null;

// Helper: Pick random animation style (with anti-repeat)
function pickAnimStyle() {
    const styles = ["fadeScale", "slideStagger", "flip", "zoomBlur", "drop", "swing", "skewSlide", "collapse"];
    let chosen;
    let retries = 0;
    const maxRetries = 3;
    
    do {
        const index = cryptoPickIndex(styles.length);
        chosen = styles[index];
        retries++;
    } while (chosen === lastAnimStyle && retries < maxRetries);
    
    lastAnimStyle = chosen;
    return chosen;
}

// Guard to prevent concurrent transitions
let isTransitioning = false;

// Guard to prevent concurrent decide animations
let isDeciding = false;

// Helper: Animate grid transition
function animateGridTransition(renderNext) {
    // Guard: prevent concurrent transitions
    if (isTransitioning) return;
    
    // Check for reduced motion preference
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) {
        renderNext();
        return;
    }
    
    // Timing constants
    const EXIT_MS = 650;
    const GAP_MS = 220;
    const ENTER_MS = 650;
    const MAX_STAGGER_EXIT = 260;
    const MAX_STAGGER_ENTER = 220;
    const EXIT_TOTAL_MS = EXIT_MS + MAX_STAGGER_EXIT; // 910ms fixed
    const ENTER_TOTAL_MS = ENTER_MS + MAX_STAGGER_ENTER; // 870ms fixed
    
    isTransitioning = true;
    
    const currentTiles = Array.from(wheelContainer.querySelectorAll('.choice-tile'));
    const animStyle = pickAnimStyle();
    // Map slideStagger to slide for CSS class names
    const animClassBase = animStyle === "slideStagger" ? "slide" : animStyle;
    const hasTiles = currentTiles.length > 0;
    
    if (!hasTiles) {
        // No tiles to animate, just render
        renderNext();
        // Apply enter animation to new tiles
        requestAnimationFrame(() => {
            const newTiles = Array.from(wheelContainer.querySelectorAll('.choice-tile'));
            if (newTiles.length === 0) {
                isTransitioning = false;
                return;
            }
            
            const staggerPer = newTiles.length > 1 ? MAX_STAGGER_ENTER / (newTiles.length - 1) : 0;
            
            newTiles.forEach((tile, i) => {
                // Start from enter-start state
                tile.classList.add(`anim-${animClassBase}-in-start`);
                // Force reflow
                tile.offsetHeight;
                // Trigger enter animation
                requestAnimationFrame(() => {
                    tile.classList.remove(`anim-${animClassBase}-in-start`);
                    tile.classList.add(`anim-${animClassBase}-in`);
                    if (animStyle === "slideStagger") {
                        const delay = i * staggerPer;
                        tile.style.transitionDelay = `${delay}ms`;
                    }
                });
            });
            
            // Reset flag after all animations complete (fixed duration)
            setTimeout(() => {
                newTiles.forEach(tile => {
                    tile.style.transitionDelay = '';
                    tile.classList.remove(`anim-${animClassBase}-in`);
                });
                isTransitioning = false;
            }, ENTER_TOTAL_MS);
        });
        return;
    }
    
    // Show overlay before exit starts
    transitionOverlay.classList.add('is-visible');
    
    // Normalized stagger for exit
    const staggerPerExit = currentTiles.length > 1 ? MAX_STAGGER_EXIT / (currentTiles.length - 1) : 0;
    
    // Apply exit animation
    currentTiles.forEach((tile, i) => {
        tile.classList.add(`anim-${animClassBase}-out`);
        if (animStyle === "slideStagger") {
            const delay = i * staggerPerExit;
            tile.style.transitionDelay = `${delay}ms`;
        }
    });
    
    // Wait for exit animation (fixed duration)
    setTimeout(() => {
        // Clear transition delays and animation classes from old tiles
        currentTiles.forEach(tile => {
            tile.style.transitionDelay = '';
            tile.classList.remove(`anim-${animClassBase}-out`);
        });
        
        // Gap before rendering new content
        setTimeout(() => {
            // Render new content
            renderNext();
            
            // Apply enter animation to new tiles
            requestAnimationFrame(() => {
                const newTiles = Array.from(wheelContainer.querySelectorAll('.choice-tile'));
                if (newTiles.length === 0) {
                    transitionOverlay.classList.remove('is-visible');
                    isTransitioning = false;
                    return;
                }
                
                // Normalized stagger for enter
                const staggerPerEnter = newTiles.length > 1 ? MAX_STAGGER_ENTER / (newTiles.length - 1) : 0;
                
                newTiles.forEach((tile, i) => {
                    // Start from enter-start state
                    tile.classList.add(`anim-${animClassBase}-in-start`);
                    // Force reflow
                    tile.offsetHeight;
                    // Trigger enter animation
                    requestAnimationFrame(() => {
                        tile.classList.remove(`anim-${animClassBase}-in-start`);
                        tile.classList.add(`anim-${animClassBase}-in`);
                        if (animStyle === "slideStagger") {
                            const delay = i * staggerPerEnter;
                            tile.style.transitionDelay = `${delay}ms`;
                        }
                    });
                });
                
                // Reset flag after all animations complete (fixed duration)
                setTimeout(() => {
                    newTiles.forEach(tile => {
                        tile.style.transitionDelay = '';
                        tile.classList.remove(`anim-${animClassBase}-in`);
                    });
                    transitionOverlay.classList.remove('is-visible');
                    isTransitioning = false;
                }, ENTER_TOTAL_MS);
            });
        }, GAP_MS);
    }, EXIT_TOTAL_MS);
}

// Helper: Get grid class based on count
function getGridClass(count, isLeaf = false) {
    if (isLeaf) return "grid-leaf";
    if (count === 2) return "grid-2";
    if (count === 3) return "grid-3";
    if (count >= 4 && count <= 6) return "grid-4-6";
    if (count >= 7 && count <= 12) return "grid-7-12";
    return "grid-leaf"; // fallback
}

// Helper: Get display count for leaf pool
function getLeafDisplayCount() {
    // Desktop: target 25-36, Mobile: target 12-15
    if (isDesktop()) {
        const options = [25, 30, 36];
        return options[cryptoPickIndex(options.length)];
    } else {
        const options = [12, 15];
        return options[cryptoPickIndex(options.length)];
    }
}

// Helper: Animate winner (fade out non-winners, then collapse to single winner)
function animateWinner(winnerTile) {
    const tiles = wheelContainer.querySelectorAll('.choice-tile');
    
    // Add fade-out to all except winner
    tiles.forEach(tile => {
        if (tile !== winnerTile) {
            tile.classList.add('fade-out');
        }
    });
    
    // After animation, remove all non-winners and set winner style
    setTimeout(() => {
        tiles.forEach(tile => {
            if (tile !== winnerTile) {
                tile.remove();
            }
        });
        
        // Change grid to single column
        wheelContainer.className = 'choice-grid grid-winner';
        
        // Add winner classes (blink starts after 200ms delay)
        winnerTile.classList.add('winner');
        setTimeout(() => {
            winnerTile.classList.add('blink');
        }, 200);
    }, 650);
}

// Helper functions for easing
function lerp(a, b, t) {
    return a + (b - a) * t;
}

function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
}

// Helper: Random integer in range [min, max] (inclusive) using crypto
function randInt(min, max) {
    if (max < min) return min;
    const range = max - min + 1;
    const array = new Uint32Array(1);
    crypto.getRandomValues(array);
    return min + (array[0] % range);
}

// Helper: Finalize winner (called after decide animation completes)
function finalizeWinner(picked) {
    state.lastResult = picked;
    state.pendingResult = null;
    renderResult();
    collapseToWinner(picked.id);
}

// Helper: Collapse to winner (called only from finalizeWinner)
function collapseToWinner(winnerId) {
    const winnerTile = wheelContainer.querySelector(`.choice-tile[data-kind="item"][data-id="${winnerId}"]`);
    if (!winnerTile) {
        console.error("collapseToWinner: winner not found", winnerId);
        return;
    }
    
    animateWinner(winnerTile);
}

// Helper: Run final decide animation with roulette effect
function runFinalDecideAnimation(winnerId, onDone) {
    // Guard: prevent concurrent decide animations
    if (isDeciding) return;
    
    isDeciding = true;
    wheelContainer.classList.add('is-deciding');
    
    // Find winner tile first
    let winnerEl = wheelContainer.querySelector(`.choice-tile[data-kind="item"][data-id="${winnerId}"]`);
    if (!winnerEl) {
        console.warn("Winner tile not found in grid for id:", winnerId);
        // Re-render to ensure winner is in grid
        renderWheel();
        winnerEl = wheelContainer.querySelector(`.choice-tile[data-kind="item"][data-id="${winnerId}"]`);
        if (!winnerEl) {
            console.error("Winner tile still not found after re-render:", winnerId);
            wheelContainer.classList.remove('is-deciding');
            isDeciding = false;
            if (onDone) onDone();
            return;
        }
    }
    
    // Get only item tiles (not node tiles)
    const tiles = Array.from(wheelContainer.querySelectorAll('.choice-tile[data-kind="item"]'));
    if (tiles.length === 0) {
        wheelContainer.classList.remove('is-deciding');
        isDeciding = false;
        if (onDone) onDone();
        return;
    }
    
    const TOTAL_MS = 5200;
    const PHASE2_START = 0.55;
    const PHASE3_START = 0.85;
    const LANDING_START = 0.88; // Last 12% of time
    
    let currentIndex = 0;
    const startTime = Date.now();
    let timer = null;
    let landingCandidates = null;
    let landingTickCount = 0;
    
    // Find winner tile index using dataset.id
    const winnerTileIndex = tiles.findIndex(tile => tile.dataset.id === winnerId);
    const hasWinnerInGrid = winnerTileIndex !== -1;
    const n = tiles.length;
    
    if (!hasWinnerInGrid) {
        console.error("Winner tile index not found in item tiles:", winnerId);
        wheelContainer.classList.remove('is-deciding');
        isDeciding = false;
        if (onDone) onDone();
        return;
    }
    
    // Clear any existing highlights
    tiles.forEach(tile => tile.classList.remove('is-highlight'));
    
    // Initial highlight
    if (n > 0) {
        currentIndex = randInt(0, n - 1);
        tiles[currentIndex].classList.add('is-highlight');
    }
    
    // Helper: Calculate next tick interval based on progress
    function nextInterval(progress) {
        if (progress < PHASE2_START) {
            // Phase 1: 180-240ms
            return randInt(180, 240);
        } else if (progress < PHASE3_START) {
            // Phase 2: 260-360ms
            return randInt(260, 360);
        } else {
            // Phase 3: 420-620ms
            return randInt(420, 620);
        }
    }
    
    // Helper: Pick random next index (avoid neighbors, prefer 3-10 step jumps)
    function pickNextIndex(progress) {
        if (n < 6) {
            // Small grid: just pick any different index
            let next;
            do {
                next = randInt(0, n - 1);
            } while (next === currentIndex);
            return next;
        }
        
        // Landing phase: use candidates list
        if (progress >= LANDING_START && landingCandidates && landingCandidates.length > 0) {
            landingTickCount++;
            const totalLandingTicks = 5;
            
            // Last few ticks: pattern towards winner
            if (landingTickCount >= totalLandingTicks - 2) {
                return winnerTileIndex;
            }
            
            // Earlier landing ticks: random from candidates
            const candidateIdx = randInt(0, landingCandidates.length - 1);
            return landingCandidates[candidateIdx];
        }
        
        // Normal phase: random jump with 3-10 steps
        const stepSet = [3, 4, 5, 6, 7, 8, 9, 10];
        const step = stepSet[randInt(0, stepSet.length - 1)];
        const direction = randInt(0, 1) === 0 ? 1 : -1;
        const jump = step * direction;
        let next = (currentIndex + jump + n) % n;
        
        // Ensure not same as current
        if (next === currentIndex) {
            next = (next + 1) % n;
        }
        
        // Ensure not neighbor (simplified: ±1)
        const prevNeighbor = (currentIndex - 1 + n) % n;
        const nextNeighbor = (currentIndex + 1) % n;
        if (next === prevNeighbor || next === nextNeighbor) {
            // Pick again with different step
            const altStep = stepSet[randInt(0, stepSet.length - 1)];
            const altDirection = randInt(0, 1) === 0 ? 1 : -1;
            next = (currentIndex + altStep * altDirection + n) % n;
            if (next === currentIndex) {
                next = (next + 1) % n;
            }
        }
        
        return next;
    }
    
    // Initialize landing candidates (last 12% of time)
    function initializeLandingCandidates() {
        if (!hasWinnerInGrid || n < 3) {
            landingCandidates = [winnerTileIndex];
            return;
        }
        
        landingCandidates = [winnerTileIndex];
        
        // Add 2 random non-winner indices
        const nonWinnerIndices = [];
        for (let i = 0; i < n; i++) {
            if (i !== winnerTileIndex) {
                nonWinnerIndices.push(i);
            }
        }
        
        // Pick 2 random non-winner indices
        if (nonWinnerIndices.length >= 2) {
            const idx1 = randInt(0, nonWinnerIndices.length - 1);
            landingCandidates.push(nonWinnerIndices[idx1]);
            nonWinnerIndices.splice(idx1, 1);
            const idx2 = randInt(0, nonWinnerIndices.length - 1);
            landingCandidates.push(nonWinnerIndices[idx2]);
        } else if (nonWinnerIndices.length === 1) {
            landingCandidates.push(nonWinnerIndices[0]);
        }
    }
    
    // Main step function
    function step() {
        const elapsed = Date.now() - startTime;
        const progress = elapsed / TOTAL_MS;
        
        if (progress >= 1) {
            // Done: highlight winner and wait 700ms
            tiles.forEach(tile => tile.classList.remove('is-highlight'));
            if (hasWinnerInGrid) {
                tiles[winnerTileIndex].classList.add('is-highlight');
            }
            
            setTimeout(() => {
                tiles.forEach(tile => tile.classList.remove('is-highlight'));
                wheelContainer.classList.remove('is-deciding');
                isDeciding = false;
                if (onDone) onDone();
            }, 700);
            return;
        }
        
        // Initialize landing candidates when entering landing phase
        if (progress >= LANDING_START && !landingCandidates) {
            initializeLandingCandidates();
        }
        
        // Remove highlight from current
        tiles[currentIndex].classList.remove('is-highlight');
        
        // Pick next index
        currentIndex = pickNextIndex(progress);
        
        // Add highlight to new current
        tiles[currentIndex].classList.add('is-highlight');
        
        // Schedule next step
        const interval = nextInterval(progress);
        timer = setTimeout(step, interval);
    }
    
    // Start animation
    step();
    
    // Safety timeout
    setTimeout(() => {
        if (timer) {
            clearTimeout(timer);
        }
        tiles.forEach(tile => tile.classList.remove('is-highlight'));
        if (hasWinnerInGrid) {
            tiles[winnerTileIndex].classList.add('is-highlight');
        }
        setTimeout(() => {
            tiles.forEach(tile => tile.classList.remove('is-highlight'));
            wheelContainer.classList.remove('is-deciding');
            isDeciding = false;
            if (onDone) onDone();
        }, 700);
    }, TOTAL_MS + 1000);
}

// Render wheel: children tiles or leaf preview tiles
function renderWheel() {
    wheelContainer.innerHTML = "";
    
    // Remove any winner classes
    wheelContainer.className = 'choice-grid';
    
    if (state.categoryId === null) {
        // Root: show root categories as tiles
        const rootOptions = getRootOptions();
        rootOptions.forEach((label) => {
            const tile = document.createElement("button");
            tile.className = "choice-tile";
            tile.textContent = label;
            tile.addEventListener("click", () => handleOptionClick(label));
            wheelContainer.appendChild(tile);
        });
        wheelContainer.classList.add(getGridClass(rootOptions.length, false));
        return;
    }
    
    const node = getNode(state.categoryId, state.nodeId);
    if (!node) return;
    
    if (isLeaf(node)) {
        // Leaf: show preview tiles from pool
        const displayCount = Math.min(getLeafDisplayCount(), node.pool.length);
        const previewIndices = new Set();
        
        // Always include pendingResult if it exists and is in pool (for decide animation)
        if (state.pendingResult) {
            const pendingResultIndex = node.pool.findIndex(item => item.id === state.pendingResult.id);
            if (pendingResultIndex !== -1) {
                previewIndices.add(pendingResultIndex);
            }
        }
        
        // Always include lastResult if it exists and is in pool (for showing previous result)
        if (state.lastResult && !state.pendingResult) {
            const lastResultIndex = node.pool.findIndex(item => item.id === state.lastResult.id);
            if (lastResultIndex !== -1) {
                previewIndices.add(lastResultIndex);
            }
        }
        
        // Add random items to reach displayCount
        while (previewIndices.size < displayCount) {
            const randomIndex = cryptoPickIndex(node.pool.length);
            previewIndices.add(randomIndex);
        }
        
        // Convert to array
        const indicesArray = Array.from(previewIndices);
        
        // Shuffle array randomly (Fisher-Yates shuffle)
        for (let i = indicesArray.length - 1; i > 0; i--) {
            const j = cryptoPickIndex(i + 1);
            [indicesArray[i], indicesArray[j]] = [indicesArray[j], indicesArray[i]];
        }
        
        // Ensure pendingResult is NOT first (if it exists)
        if (state.pendingResult) {
            const pendingResultIndex = node.pool.findIndex(item => item.id === state.pendingResult.id);
            if (pendingResultIndex !== -1 && indicesArray[0] === pendingResultIndex && indicesArray.length > 1) {
                // Swap with a random position from 1 to length-1
                const swapPos = cryptoPickIndex(indicesArray.length - 1) + 1;
                [indicesArray[0], indicesArray[swapPos]] = [indicesArray[swapPos], indicesArray[0]];
            }
        }
        
        // Only put lastResult first if it exists and there's NO pendingResult
        if (state.lastResult && !state.pendingResult) {
            const lastResultIndex = node.pool.findIndex(item => item.id === state.lastResult.id);
            if (lastResultIndex !== -1) {
                const idx = indicesArray.indexOf(lastResultIndex);
                if (idx > 0) {
                    indicesArray.splice(idx, 1);
                    indicesArray.unshift(lastResultIndex);
                }
            }
        }
        
        // Render tiles
        indicesArray.forEach(index => {
            const item = node.pool[index];
            const tile = document.createElement("button");
            tile.className = "choice-tile";
            tile.textContent = item.label;
            tile.dataset.kind = "item";
            tile.dataset.id = item.id;
            
            tile.addEventListener("click", () => {
                console.log("TILE CLICK:", tile.dataset.kind, tile.dataset.id, tile.textContent);
                handlePreviewItemClick(item);
            });
            wheelContainer.appendChild(tile);
        });
        
        wheelContainer.classList.add("grid-leaf");
        
    } else if (node.children && node.children.length > 0) {
        // Non-leaf: show children as tiles
        node.children.forEach(childId => {
            const childNode = getNode(state.categoryId, childId);
            if (!childNode) return;
            
            const tile = document.createElement("button");
            tile.className = "choice-tile";
            tile.textContent = childNode.label;
            tile.dataset.kind = "node";
            tile.dataset.id = childId;
            tile.addEventListener("click", () => handleChildClick(childId, childNode.label));
            wheelContainer.appendChild(tile);
        });
        wheelContainer.classList.add(getGridClass(node.children.length, false));
    }
}

// Handle child node click
function handleChildClick(childNodeId, childLabel) {
    state.path.push({ nodeId: childNodeId, label: childLabel });
    state.nodeId = childNodeId;
    state.lastResult = null;
    state.pendingResult = null;
    
    // Clear result
    resultContainer.innerHTML = "";
    
    // Animate grid transition
    animateGridTransition(() => {
        render();
    });
}

// Handle preview item click (treat as final result)
function handlePreviewItemClick(item) {
    // Get current leaf node id
    const currentNode = getNode(state.categoryId, state.nodeId);
    if (currentNode && isLeaf(currentNode)) {
        const leafNodeId = state.nodeId;
        
        // Save to recent
        pushRecent(leafNodeId, item.id);
        console.log("PICKED (anti-repeat):", leafNodeId, item);
    }
    
    // Instant win: finalize immediately
    state.lastResult = item;
    state.pendingResult = null;
    render();
    collapseToWinner(item.id);
}

// Handle option click (root category selection)
function handleOptionClick(label) {
    if (state.categoryId === null) {
        // Root category selection
        const categoryId = Object.keys(ROOT_CATEGORIES).find(
            key => ROOT_CATEGORIES[key] === label
        );
        
        if (!categoryId) return;
        
        // Check if category has data
        if (!DATA[categoryId] || !DATA[categoryId][`${categoryId}_root`]) {
            return; // Category not available
        }
        
        const rootNodeId = `${categoryId}_root`;
        const rootNode = getNode(categoryId, rootNodeId);
        if (!rootNode) return;
        
        state.categoryId = categoryId;
        state.nodeId = rootNodeId;
        state.path = [{ nodeId: rootNodeId, label: rootNode.label }];
        state.lastResult = null;
        state.pendingResult = null;
        
        // Show affiliate panel only for travel and only on desktop
        if (categoryId === "travel" && isDesktop()) {
            affiliatePanel.classList.add("is-visible");
        } else {
            affiliatePanel.classList.remove("is-visible");
        }
        
        // Animate grid transition
        animateGridTransition(() => {
            render();
        });
    }
}

// Render breadcrumbs with clickable items
function renderBreadcrumbs() {
    breadcrumbsContainer.innerHTML = "";
    
    if (state.path.length === 0) {
        return;
    }
    
    state.path.forEach((crumb, index) => {
        const isLast = index === state.path.length - 1;
        
        if (isLast) {
            // Last crumb: not clickable
            const span = document.createElement("span");
            span.className = "breadcrumb-item breadcrumb-current";
            span.textContent = crumb.label;
            breadcrumbsContainer.appendChild(span);
        } else {
            // Clickable crumb
            const button = document.createElement("button");
            button.className = "breadcrumb-item breadcrumb-link";
            button.textContent = crumb.label;
            button.setAttribute("data-node-id", crumb.nodeId);
            button.addEventListener("click", () => handleBreadcrumbClick(index));
            breadcrumbsContainer.appendChild(button);
        }
        
        // Add separator (except for last)
        if (!isLast) {
            const separator = document.createElement("span");
            separator.className = "breadcrumb-separator";
            separator.textContent = " › ";
            breadcrumbsContainer.appendChild(separator);
        }
    });
}

// Handle breadcrumb click (jump to node)
function handleBreadcrumbClick(index) {
    // Guard: prevent navigation during decide animation
    if (isDeciding) return;
    
    const targetCrumb = state.path[index];
    if (!targetCrumb) return;
    
    // Cut path to this index (inclusive)
    state.path = state.path.slice(0, index + 1);
    state.nodeId = targetCrumb.nodeId;
    state.lastResult = null;
    state.pendingResult = null;
    
    // Clear result
    resultContainer.innerHTML = "";
    
    // Animate grid transition
    animateGridTransition(() => {
        render();
    });
}

// Render result
function renderResult() {
    const hasFinal = !!state.lastResult;
    const isPending = !!state.pendingResult;
    
    if (state.lastResult) {
        resultContainer.innerHTML = `<div class="result-content" style="font-size: 1.5rem; font-weight: 600; color: #000;">Η τύχη διάλεξε: ${state.lastResult.label}</div>`;
    } else if (state.pendingResult) {
        resultContainer.innerHTML = `<div class="result-content" style="font-size: 1.5rem; font-weight: 600; color: #666;">Η τύχη αποφασίζει…</div>`;
    } else {
        resultContainer.innerHTML = "";
    }
    
    // Ξανά / Copy: μόνο σε final & όχι pending
    resultActions.hidden = !(hasFinal && !isPending);
    
    // Συνταγή: final & food & όχι pending
    recipeBtn.hidden = !(hasFinal && !isPending && state.categoryId === "food");
}

// Render controls (enable/disable buttons)
function renderControls() {
    // Back button enabled if we have a category
    backBtn.disabled = state.categoryId === null;
    
    // Decide button always enabled
    decideBtn.disabled = false;
    
    // Home button: hidden when at root, visible when not at root
    if (state.categoryId === null) {
        homeBtn.classList.add("hidden");
    } else {
        homeBtn.classList.remove("hidden");
    }
}

// Main render function
function render() {
    renderBreadcrumbs();
    renderWheel();
    renderResult();
    renderControls();
}

// Handle back button
function handleBack() {
    // Guard: prevent navigation during decide animation
    if (isDeciding) return;
    
    if (state.categoryId === null) {
        return;
    }
    
    if (state.path.length > 1) {
        // Go one level back
        state.path.pop();
        const lastCrumb = state.path[state.path.length - 1];
        state.nodeId = lastCrumb.nodeId;
        state.lastResult = null;
        state.pendingResult = null;
        
        // Animate grid transition
        animateGridTransition(() => {
            render();
        });
        
    } else if (state.path.length === 1) {
        // Reset to root categories
        state.categoryId = null;
        state.nodeId = null;
        state.path = [];
        state.lastResult = null;
        state.pendingResult = null;
        
        // Hide affiliate panel
        affiliatePanel.classList.remove("is-visible");
        
        // Animate grid transition
        animateGridTransition(() => {
            render();
        });
    }
}

// Handle decide button
function handleDecide() {
    if (state.categoryId === null) {
        // At root: pick random category
        const categories = Object.keys(ROOT_CATEGORIES);
        const randomIndex = cryptoPickIndex(categories.length);
        let categoryId = categories[randomIndex];
        
        // Verify category has data
        if (!DATA[categoryId] || !DATA[categoryId][`${categoryId}_root`]) {
            // Fallback to first available category
            const availableCategory = Object.keys(ROOT_CATEGORIES).find(
                cat => DATA[cat] && DATA[cat][`${cat}_root`]
            );
            if (!availableCategory) return;
            categoryId = availableCategory;
        }
        
        const rootNodeId = `${categoryId}_root`;
        const rootNode = getNode(categoryId, rootNodeId);
        if (!rootNode) return;
        
        // Show affiliate panel only for travel and only on desktop
        if (categoryId === "travel" && isDesktop()) {
            affiliatePanel.classList.add("is-visible");
        } else {
            affiliatePanel.classList.remove("is-visible");
        }
        
        // Random walk to leaf and immediately decide
        // walkToLeaf includes the starting node in the path
        const { nodeId: leafNodeId, path: walkPath } = walkToLeaf(categoryId, rootNodeId);
        state.categoryId = categoryId;
        state.nodeId = leafNodeId;
        state.path = walkPath;
        
        // Pick final result from leaf pool (with anti-repeat)
        const leafNode = getNode(categoryId, leafNodeId);
        if (leafNode && isLeaf(leafNode) && leafNode.pool && leafNode.pool.length > 0) {
            const picked = pickFromPoolAvoidingRecent(leafNodeId, leafNode.pool);
            state.pendingResult = picked;
            state.lastResult = null;
            pushRecent(leafNodeId, picked.id);
            console.log("PICKED WINNER:", picked.id, picked.label);
            
            // Re-render to show winner tile in grid
            render();
            
            // Run final decide animation with roulette
            runFinalDecideAnimation(picked.id, () => {
                finalizeWinner(picked);
            });
        } else {
            render();
        }
        
    } else {
        const currentNode = getNode(state.categoryId, state.nodeId);
        if (!currentNode) return;
        
        if (isLeaf(currentNode)) {
            // At leaf: pick from pool with anti-repeat
            if (currentNode.pool && currentNode.pool.length > 0) {
                const leafNodeId = state.nodeId;
                const picked = pickFromPoolAvoidingRecent(leafNodeId, currentNode.pool);
                state.pendingResult = picked;
                state.lastResult = null;
                pushRecent(leafNodeId, picked.id);
                console.log("PICKED WINNER:", picked.id, picked.label);
                
                // Re-render to show winner tile in grid
                render();
                
                // Run final decide animation with roulette
                runFinalDecideAnimation(picked.id, () => {
                    finalizeWinner(picked);
                });
            } else {
                render();
            }
            
        } else {
            // At non-leaf: random walk to leaf and immediately decide
            const { nodeId: leafNodeId, path: walkPath } = walkToLeaf(state.categoryId, state.nodeId);
            state.nodeId = leafNodeId;
            state.path = walkPath;
            
            // Pick final result from leaf pool (with anti-repeat)
            const leafNode = getNode(state.categoryId, leafNodeId);
            if (leafNode && isLeaf(leafNode) && leafNode.pool && leafNode.pool.length > 0) {
                const picked = pickFromPoolAvoidingRecent(leafNodeId, leafNode.pool);
                state.pendingResult = picked;
                state.lastResult = null;
                pushRecent(leafNodeId, picked.id);
                console.log("PICKED WINNER:", picked.id, picked.label);
                
                // Re-render to show winner tile in grid
                render();
                
                // Run final decide animation with roulette
                runFinalDecideAnimation(picked.id, () => {
                    finalizeWinner(picked);
                });
            } else {
                render();
            }
        }
    }
}

// Handle home button
function handleHome() {
    // Guard: prevent navigation during decide animation
    if (isDeciding) return;
    
    // Reset all state
    state.categoryId = null;
    state.nodeId = null;
    state.path = [];
    state.lastResult = null;
    state.pendingResult = null;
    
    // Hide affiliate panel
    affiliatePanel.classList.remove("is-visible");
    
    // Animate grid transition
    animateGridTransition(() => {
        render();
    });
}

// Handle replay button
function handleReplay() {
    // Guard: prevent replay if no result or during decide animation
    if (!state.lastResult || isDeciding) return;
    
    // Must be at a leaf node
    if (!state.categoryId || !state.nodeId) return;
    
    const currentNode = getNode(state.categoryId, state.nodeId);
    if (!currentNode || !isLeaf(currentNode)) return;
    
    // Clear results
    state.lastResult = null;
    state.pendingResult = null;
    
    // Pick from pool with anti-repeat (same logic as handleDecide at leaf)
    if (currentNode.pool && currentNode.pool.length > 0) {
        const leafNodeId = state.nodeId;
        const picked = pickFromPoolAvoidingRecent(leafNodeId, currentNode.pool);
        state.pendingResult = picked;
        state.lastResult = null;
        pushRecent(leafNodeId, picked.id);
        console.log("PICKED WINNER (replay):", picked.id, picked.label);
        
        // Re-render to show winner tile in grid
        render();
        
        // Run final decide animation with roulette
        runFinalDecideAnimation(picked.id, () => {
            finalizeWinner(picked);
        });
    }
}

// Helper: Build recipe copy text
function buildRecipeCopyText(recipe, fallbackTitle, fallbackText) {
    if (!recipe) {
        return `${fallbackTitle}\n\n${fallbackText}`;
    }
    
    let text = recipe.title || fallbackTitle;
    
    // Add meta
    const metaLine = `⏱️ ${recipe.timeMinutes ?? "—"}' • 🍽️ ${recipe.servings ?? "—"} μερίδες`;
    text += `\n${metaLine}`;
    
    // Add ingredients
    text += `\n\nΥλικά:`;
    if (recipe.ingredients && Array.isArray(recipe.ingredients)) {
        recipe.ingredients.forEach(ing => {
            text += `\n- ${ing}`;
        });
    }
    
    // Add steps
    text += `\n\nΒήματα:`;
    if (recipe.steps && Array.isArray(recipe.steps)) {
        recipe.steps.forEach((step, index) => {
            text += `\n${index + 1}) ${step}`;
        });
    }
    
    // Add tips if they exist
    if (recipe.tips && Array.isArray(recipe.tips) && recipe.tips.length > 0) {
        text += `\n\nTips:`;
        recipe.tips.forEach(tip => {
            text += `\n- ${tip}`;
        });
    }
    
    return text;
}

// Helper: Copy to clipboard with fallback
async function copyToClipboard(text) {
    if (navigator.clipboard?.writeText) {
        return navigator.clipboard.writeText(text);
    }
    // Fallback for older browsers
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
}

// Handle recipe button
function handleRecipe() {
    if (!state.lastResult || state.categoryId !== "food") return;
    
    const id = state.lastResult.id;
    const recipe = RECIPES?.[id];
    
    // Clear lists
    recipeIngredients.innerHTML = "";
    recipeSteps.innerHTML = "";
    recipeTips.innerHTML = "";
    
    if (!recipe) {
        const fallbackTitle = state.lastResult?.label || "Συνταγή";
        const fallbackText = "Συνταγή σύντομα.";
        recipeTitle.textContent = fallbackTitle;
        recipeMeta.textContent = "";
        recipeIngredients.innerHTML = `<li>${fallbackText}</li>`;
        recipeSteps.innerHTML = "";
        recipeTipsWrap.hidden = true;
        
        // Build copy text for fallback
        currentRecipeCopyText = buildRecipeCopyText(null, fallbackTitle, fallbackText);
    } else {
        const recipeTitleText = recipe.title || state.lastResult.label;
        recipeTitle.textContent = recipeTitleText;
        recipeMeta.textContent = `⏱️ ${recipe.timeMinutes ?? "—"}' • 🍽️ ${recipe.servings ?? "—"} μερίδες`;
        
        // Fill ingredients
        if (recipe.ingredients && Array.isArray(recipe.ingredients)) {
            recipe.ingredients.forEach(ing => {
                const li = document.createElement("li");
                li.textContent = ing;
                recipeIngredients.appendChild(li);
            });
        }
        
        // Fill steps
        if (recipe.steps && Array.isArray(recipe.steps)) {
            recipe.steps.forEach(step => {
                const li = document.createElement("li");
                li.textContent = step;
                recipeSteps.appendChild(li);
            });
        }
        
        // Handle tips
        if (recipe.tips && Array.isArray(recipe.tips) && recipe.tips.length > 0) {
            recipe.tips.forEach(tip => {
                const li = document.createElement("li");
                li.textContent = tip;
                recipeTips.appendChild(li);
            });
            recipeTipsWrap.hidden = false;
        } else {
            recipeTipsWrap.hidden = true;
        }
        
        // Build copy text
        currentRecipeCopyText = buildRecipeCopyText(recipe, recipeTitleText, "");
    }
    
    recipeModal.hidden = false;
}

// Event listeners
backBtn.addEventListener("click", handleBack);
decideBtn.addEventListener("click", handleDecide);
homeBtn.addEventListener("click", handleHome);
replayBtn.addEventListener("click", handleReplay);
recipeBtn.addEventListener("click", handleRecipe);

// Recipe copy button handler
recipeCopyBtn.addEventListener("click", async () => {
    try {
        await copyToClipboard(currentRecipeCopyText || "");
        
        // Add feedback
        const originalText = recipeCopyBtn.textContent;
        recipeCopyBtn.textContent = "Αντιγράφηκε!";
        recipeCopyBtn.classList.add('is-copied');
        
        // Reset after 1.5s
        setTimeout(() => {
            recipeCopyBtn.textContent = originalText;
            recipeCopyBtn.classList.remove('is-copied');
        }, 1500);
    } catch (err) {
        console.error('Failed to copy recipe text:', err);
    }
});

// Modal close handlers
recipeModal.addEventListener("click", (e) => {
    if (e.target?.dataset?.close === "1") {
        recipeModal.hidden = true;
    }
});

document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !recipeModal.hidden) {
        recipeModal.hidden = true;
    }
});

// Handle window resize to show/hide affiliate panel appropriately
window.addEventListener("resize", () => {
    if (state.categoryId === "travel" && isDesktop()) {
        affiliatePanel.classList.add("is-visible");
    } else {
        affiliatePanel.classList.remove("is-visible");
    }
});

// Initialize
function init() {
    render();
}

// Start app
init();
