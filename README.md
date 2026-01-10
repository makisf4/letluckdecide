# letluckdecide.com

Μια minimal static web εφαρμογή που βοηθάει τους χρήστες να αποφασίσουν με τυχαίο τρόπο, χρησιμοποιώντας ένα interactive grid-based decision system.

## Τι είναι το project

Αυτό είναι ένα static single-page web application που παρουσιάζει ένα decision-making system. Ο χρήστης επιλέγει μια κατηγορία (π.χ. "Ταξιδεύω", "Μαγειρεύω", "Διασκεδάζω") και το σύστημα του προτείνει τυχαίες επιλογές μέσα από υποκατηγορίες μέχρι να φτάσει σε ένα τελικό αποτέλεσμα.

## Κύρια Χαρακτηριστικά

### Navigation & UI
- **Tree-based navigation**: Ιεραρχική πλοήγηση μέσα σε κατηγορίες και υποκατηγορίες
- **Grid layout**: Interactive grid με tiles αντί για παραδοσιακό wheel
- **Breadcrumbs**: Εμφάνιση path navigation με δυνατότητα επιστροφής
- **Responsive design**: Mobile-first approach με desktop optimizations

### Animations & UX
- **Cinematic transitions**: Smooth grid transitions με σταθερή διάρκεια (650ms base + stagger)
- **Final decide effect**: Roulette animation (5.2s) με accelerating/decelerating highlight πριν την τελική επιλογή
- **Winner animation**: Collapse-to-winner με blink effect
- **Transition overlay**: Visual feedback κατά τη μετάβαση μεταξύ states (opacity-only, no blur)
- **Reduced motion support**: Respect για `prefers-reduced-motion`
- **8 animation styles**: fadeScale, slideStagger, flip, zoomBlur, drop, swing, skewSlide, collapse

### Decision Logic
- **Random walk**: Αυτόματη πλοήγηση από root σε leaf node
- **Anti-repeat system**: Αποφυγή πρόσφατων αποτελεσμάτων (localStorage-based)
- **Crypto-based randomness**: Χρήση `crypto.getRandomValues()` για ασφαλή τυχαίότητα
- **Early decide**: Δυνατότητα instant decision όταν ο χρήστης είναι ήδη σε leaf

### Data Structure
- **Tree-based categories**: Ιεραρχική δομή δεδομένων (travel, food, fun)
- **Leaf nodes**: Τελικά αποτελέσματα (pool of items)
- **Modular data**: Χωριστό `data.js` module
- **Recipe data**: Χωριστό `recipes.js` module με συνταγές για food items (160+ recipes)

### Result Actions
- **Replay button**: Ξανα-τρέχει decide στο ίδιο leaf node (με anti-repeat)
- **Copy button**: Αντιγραφή αποτελέσματος στο clipboard με visual feedback
- **Recipe button**: Εμφάνιση modal με συνταγή (μόνο για food category αποτελέσματα)
- **Recipe modal**: Πλήρης συνταγή με υλικά, βήματα, tips, time/servings info

## Πώς να ανοίξεις local

### Με Live Server (VS Code extension)
1. Εγκατάστησε το extension "Live Server" στο VS Code
2. Κάνε right-click στο `index.html`
3. Επίλεξε "Open with Live Server"

### Με Python
```bash
# Python 3
python3 -m http.server 8000

# Μετά, άνοιξε http://localhost:8000 στο browser
```

### Με Node.js (http-server)
```bash
npx http-server -p 8000
```

### Με PHP
```bash
php -S localhost:8000
```

## Δομή αρχείων

```
LUCKDECIDES/
├── index.html          # Κύρια HTML δομή
├── styles.css          # Styling (mobile-first, cinematic transitions)
├── app.js              # State machine, navigation, animations
├── data.js             # Data structures (categories, trees, items)
├── recipes.js          # Recipe data για food items
└── README.md           # Αυτό το αρχείο
```

## Τεχνολογίες

- **Pure HTML/CSS/JavaScript** (ES6 modules, χωρίς frameworks)
- **Mobile-first responsive design**
- **State machine pattern** για navigation
- **CSS transitions & animations** για smooth UX
- **localStorage API** για anti-repeat tracking
- **Web Crypto API** για secure randomness

## Κύριες Λειτουργίες

### Navigation
- **Root → Category**: Επιλογή βασικής κατηγορίας
- **Category → Subcategories**: Πλοήγηση σε υποκατηγορίες
- **Subcategories → Leaf**: Φθάνοντας σε τελικό pool items
- **Back/Home**: Επιστροφή σε προηγούμενα levels

### Decision Making
- **Decide Button**: 
  - Αν στο root: random walk → leaf → roulette → winner
  - Αν σε non-leaf: random walk → leaf → roulette → winner
  - Αν σε leaf: roulette → winner
- **Click Leaf Item**: Instant win (χωρίς roulette)
- **Anti-repeat**: Αποφυγή πρόσφατων αποτελεσμάτων (max 20 recent per leaf)
- **Winner positioning**: Winner δεν τοποθετείται πρώτο στο grid (shuffled + swap logic)

### Animations
- **Grid Transitions**: 910ms exit + 220ms gap + 870ms enter (normalized stagger)
- **Roulette Effect**: 5.2s total (5200ms) με 3 phases (accelerating/decelerating tick intervals)
- **Winner Collapse**: Fade-out non-winners (650ms), collapse to single winner with blink
- **Transition overlay**: Opacity-only overlay (no blur effects)

## Technical Details

### Timing Constants
- **Base transitions**: 650ms cubic-bezier(.16, 1, .3, 1)
- **Stagger windows**: 260ms (exit), 220ms (enter)
- **Fixed total durations**: Independent of tile count
- **Roulette**: 5200ms total (5.2s) με 3 phases:
  - Phase 1 (0-55%): 180-240ms tick intervals
  - Phase 2 (55-85%): 260-360ms tick intervals
  - Phase 3 (85-100%): 420-620ms tick intervals
  - Landing phase (88-100%): Pattern towards winner
- **Winner collapse**: 650ms fade-out + blink animation

### State Management
- Single state object:
  - `categoryId`: null | "travel" | "food" | "fun"
  - `nodeId`: current node id
  - `path`: array of {nodeId, label} for breadcrumbs
  - `pendingResult`: {id, label} during animation
  - `lastResult`: {id, label} final result (after animation completes)
- No external state management libraries
- localStorage for persistence (anti-repeat only)
- Result visibility: buttons show only when `hasFinal && !isPending`

### Performance
- RequestAnimationFrame for smooth animations
- Efficient DOM updates
- No unnecessary re-renders
- Guard flags to prevent concurrent animations

## Browser Support

- Modern browsers (ES6 modules support required)
- Chrome, Firefox, Safari, Edge (latest versions)
- Mobile browsers (iOS Safari, Chrome Mobile)

## Recent Updates

- ✅ Recipe modal system για food items
- ✅ Replay/Copy buttons με proper visibility logic
- ✅ Winner positioning fix (winner δεν μπαίνει πρώτο)
- ✅ Result display timing fix (μόνο μετά animation completion)
- ✅ Blur effects removal (cleaner, performance-friendly transitions)
- ✅ Button visibility fixes (hidden on initial load, during animations)

## Future Enhancements (Potential)

- Wheel visualization (canvas/SVG)
- Custom categories/user data
- Share results functionality (beyond copy button)
- Analytics/usage tracking
