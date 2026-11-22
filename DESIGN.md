---
name: UOMi
description: Shared costs, agreed by everyone in them. A duplicate bill book for flatmates, trips and families.
colors:
  ground: "#EEF0F4"
  sheet: "#FFFFFF"
  sheet-2: "#F6F7FA"
  stage: "#D7DBE3"
  ink: "#1B1F2A"
  ink-2: "#5F6574"
  carbon: "#23308A"
  carbon-press: "#1A246C"
  on-carbon: "#FFFFFF"
  carbon-wash: "rgba(35, 48, 138, .08)"
  owe: "#B8322A"
  owed: "#1D734A"
  pending: "#7F6200"
  dup-pink: "#F2C4CE"
  dup-pink-edge: "#D99AAA"
  dup-yellow: "#F3DF73"
  dup-yellow-edge: "#CDB548"
  perf: "#8C92A0"
  hair: "rgba(95, 101, 116, .22)"
  hair-strong: "rgba(95, 101, 116, .38)"
  control-edge: "#767C8C"
  badge: "#F3DF73"
  scrim: "rgba(17, 20, 33, .44)"
  ground-dark: "#10142A"
  sheet-dark: "#1A1F3D"
  sheet-2-dark: "#20264A"
  ink-dark: "#ECEEF6"
  ink-2-dark: "#A9AFC7"
  carbon-dark: "#A9BCFF"
  on-carbon-dark: "#10142A"
  owe-dark: "#FF9A90"
  owed-dark: "#7AD9A8"
  pending-dark: "#E9CF5C"
  dup-pink-dark: "#6A3550"
  dup-yellow-dark: "#6E5C1C"
  member-1: "#23308A"
  member-2: "#9C3B5C"
  member-3: "#1D6B63"
  member-4: "#8A5A12"
  member-5: "#5B3E99"
  member-6: "#2E6E2E"
typography:
  display:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "32px"
    fontWeight: 600
    lineHeight: "38px"
    letterSpacing: "-0.02em"
    fontVariation: "'WONK' 0, 'SOFT' 0"
  hero-figure:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "40px"
    fontWeight: 600
    lineHeight: "48px"
    letterSpacing: "-0.02em"
    fontFeature: "lnum"
  figure:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "28px"
    fontWeight: 600
    lineHeight: "34px"
    letterSpacing: "-0.005em"
    fontFeature: "lnum"
  wordmark:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "22px"
    fontWeight: 700
    lineHeight: "28px"
    letterSpacing: "-0.015em"
  title:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: "26px"
  body:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: "22px"
  label:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: "18px"
  serial:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: "18px"
    letterSpacing: "0.08em"
  stamp:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "12px"
    fontWeight: 700
    lineHeight: "14px"
    letterSpacing: "0.12em"
rounded:
  sheet: "6px"
  segment: "9px"
  plate-lg: "12px"
  bottom-sheet: "14px"
  pill: "999px"
spacing:
  s1: "4px"
  s2: "8px"
  s3: "12px"
  s4: "16px"
  s5: "20px"
  s6: "24px"
  s8: "32px"
  s10: "40px"
  gutter: "16px"
components:
  button-primary:
    backgroundColor: "{colors.carbon}"
    textColor: "{colors.on-carbon}"
    typography: "{typography.body}"
    rounded: "{rounded.sheet}"
    padding: "0 20px"
    height: "52px"
  button-primary-active:
    backgroundColor: "{colors.carbon-press}"
  button-secondary:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.carbon}"
    rounded: "{rounded.sheet}"
    padding: "0 20px"
    height: "52px"
  button-danger:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.owe}"
    rounded: "{rounded.sheet}"
    padding: "0 20px"
    height: "52px"
  answer-accept:
    backgroundColor: "{colors.carbon}"
    textColor: "{colors.on-carbon}"
    rounded: "{rounded.pill}"
    size: "44px"
  answer-reject:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.pill}"
    size: "44px"
  fab:
    backgroundColor: "{colors.carbon}"
    textColor: "{colors.on-carbon}"
    rounded: "{rounded.pill}"
    size: "60px"
  input:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.sheet}"
    padding: "0 14px"
    height: "52px"
  chip:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink-2}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "44px"
  chip-selected:
    backgroundColor: "{colors.carbon}"
    textColor: "{colors.on-carbon}"
  bill-sheet:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sheet}"
    padding: "12px"
  ledger-row:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    padding: "12px"
    height: "68px"
  tab-bar:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink-2}"
    typography: "{typography.label}"
    height: "58px"
  tab-active:
    textColor: "{colors.carbon}"
  badge:
    backgroundColor: "{colors.badge}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    size: "24px"
---

# Design System: UOMi

## Overview

**Creative North Star: "The Duplicate Bill Book"**

Every expense is a bill written once and carbon-copied to everyone in it; a share only counts when its duplicate is accepted. The interface is a stationery pad, not a dashboard: a cool grey-blue ground, white original sheets with a dashed perforated top edge, pink duplicate and yellow triplicate copies peeking out beneath anything still awaiting an answer, and carbon-blue ink for figures and actions. Agreement is marked the way an office marks it, with a round rubber stamp.

The world carries over to dark as carbon paper: an indigo-black ground, deep-navy sheets, pale-blue carbon ink, and the duplicates darkened to plum and ochre rather than inverted. Density is phone-comfortable: one 16px gutter, 44px minimum hit targets, ruled ledger rows of at least 68px. One serif, Fraunces, carries everything from the 12px stamp lettering to 40px hero amounts.

The world rejects the fintech default: no gradient balance cards, no avatar walls, no glassy dashboards. People are represented by small square colour plates with initials, not round photo stacks.

**Key Characteristics:**
- Paper sheets (6px corners, hairline border) on a tinted ground; tonal layering first, soft shadow only on things that float.
- Pending state is physical: offset, slightly rotated pink/yellow duplicate sheets under the original.
- Carbon blue is the single action and figure ink; red and green carry owe/owed meaning only.
- Small-caps serials ("NO. 0412") and round stamps are the world's native typographic marks.
- Motion is paper motion: drawer slides, 0.92–0.98 press compression, stamps that land firmly with no overshoot.

## Colors

A cool, low-chroma paper palette with one ink colour and two ledger meaning colours; the duplicate tints are the only warm surfaces.

### Primary
- **Carbon Ink** (carbon): every primary button, the accept control, the FAB, selected chips and segments, the active tab and its indicator, links, focus rings, and figures in the running total and on detail screens. Pressed state deepens to Carbon Press (carbon-press). In dark, Pale Carbon (carbon-dark) with Ground-dark text on it.
- **Carbon Wash** (carbon-wash): the pressed/hover tint for rows and icon buttons, the background of space icons, and the highlight of your own share row.

### Secondary
- **Stamp Red / Owe** (owe): "You owe" amounts, rejected and disputed tags, the danger button label, field errors, required-field marks, the unread dot, and the red stamp for rejected / not received.
- **Ledger Green / Owed** (owed): "You're owed" amounts and success helper text. Never used as a button fill.
- **Pending Ochre** (pending): "Pending" and "Needs your answer" tags. Text and outline only.

### Tertiary
- **Duplicate Pink** (dup-pink, edge dup-pink-edge): the first copy beneath a pending share.
- **Triplicate Yellow** (dup-yellow, edge dup-yellow-edge): the second copy beneath a pending share, the single copy beneath a pending payment, the disputed banner fill, and the notification badge (badge).

### Neutral
- **Cool Ground** (ground): the screen background and bottom-bar fill. In dark, Indigo Black (ground-dark).
- **Original Sheet** (sheet): cards, ledger lists, inputs, tab bar, bottom sheets. Sheet Tint (sheet-2) for segmented-control tracks, split-editor footers, and lists nested inside a bottom sheet.
- **Ink** (ink) for primary text; **Faded Ink** (ink-2) for secondary text, serials, meta, inactive tabs.
- **Perforation Grey** (perf): the 2px dashed top edge of original bills.
- **Hairline** (hair) between rows and around sheets; **Strong Hairline** (hair-strong) for the running-total rules, grab handle and amount-field underline; **Control Edge** (control-edge) for input, chip, checkbox and secondary-button borders and the off switch track.
- **Member Plates** (member-1 to member-6): one fixed colour per person, used everywhere that person appears; each has a lighter dark-theme twin in tokens.css.

### Named Rules
**The One Ink Rule.** Carbon blue is the only colour that means "act" or "this is a figure". Red and green describe a balance's direction; they never fill a button.

**The Duplicate Means Pending Rule.** Pink and yellow copies appear only beneath something awaiting someone's answer. When it is answered, the copies leave. Never use the duplicate tints as decoration.

## Typography

**Display Font:** Fraunces (with Georgia, serif)
**Body Font:** Fraunces (with Georgia, serif)

**Character:** A single soft-serif voice used at every size, set with WONK 0 and SOFT 0 so it reads as an honest ledger hand rather than a quirky display face. Weight, size and small-caps tracking do all the hierarchy work.

### Hierarchy
- **Display** (600, 32px/38px, -0.02em): large screen titles.
- **Hero Figure** (600, 40px/48px, -0.02em, lining numerals, carbon): the amount on expense detail and the amount entry field.
- **Figure** (600, 28px/34px, lining numerals, carbon): running-total lines, space balance, currency symbol in the amount field.
- **Wordmark** (700, 22px/28px, -0.015em): the UOMi placeholder wordmark on Home.
- **Title** (600, 20px/26px): app-bar titles, section headings, dialog and bottom-sheet headings, expense titles on bills.
- **Body** (400, 16px/22px): all running text, row names, inputs. Bill titles stay at 400 so the figure carries the weight.
- **Label** (600, 13px/18px): sub-lines, helper text, field labels, tabs, chips, segments, badge.
- **Serial** (600, 13px/18px, 0.08em, uppercase): bill and space serials ("NO. 0412") and month dividers in the transaction ledger.
- **Stamp** (700, 12px/14px, 0.12em, uppercase): stamp lettering; 12px is also the floor for status tags.

### Named Rules
**The One Hand Rule.** Fraunces only, WONK 0, SOFT 0. The React Native build uses five static instances (Text opsz 14 at 400/600/700, Display opsz 72 at 600/700; Display only at 28px and up); do not add a second family. If small text fails on a low-end phone, go heavier or larger, never a different face.

**The Ragged Figures Rule.** Fraunces has no tabular figures. Right-align amounts, never rely on digit columns lining up, and never animate counting numbers. A changed figure swaps in with a short drop, not a ticker.

## Layout

A single phone column on a 4px grid (steps 4, 8, 12, 16, 20, 24, 32, 40) with one 16px gutter. Screens stack under an inset top area (47px) and a 52px app bar; tab screens reserve a 58px tab bar plus 34px bottom inset, and scroll content pads past it (plus 96px when a FAB is present). Section headings sit 28px above their content group and 10px above it.

Home opens with a two-column strip: the pending bill (flexible) beside a fixed 124px Create Space sheet, gap 20px, 150px tall. Lists are one sheet of ruled rows rather than separate cards. Form fields stack with 18px gaps; label-to-control is 6px. Fixed actions live in a bottom bar on the ground colour with a hairline above.

## Elevation & Depth

Depth is mostly tonal and physical: white sheets on a tinted ground, separated by hairlines. The duplicate copies are real offset, rotated sheets (5px/7px at 0.7deg, 10px/14px at 1.5deg), not shadows. Soft shadows are reserved for things that float above the page; in dark they become plain black at higher opacity.

### Shadow Vocabulary
- **Lift 1** (`box-shadow: 0 1px 2px rgba(27,31,42,.06), 0 2px 6px rgba(27,31,42,.05)`): the selected segment and the switch thumb.
- **Lift 2** (`box-shadow: 0 6px 16px rgba(27,31,42,.10), 0 2px 4px rgba(27,31,42,.06)`): FAB and toasts.
- **Lift 3** (`box-shadow: 0 18px 40px rgba(17,20,33,.22), 0 4px 10px rgba(17,20,33,.10)`): pop-ups and dialogs.

### Named Rules
**The Paper Stays Flat Rule.** Sheets, rows and inputs sit flat with a hairline. Only floating layers (FAB, toast, pop-up, dialog) cast a soft shadow, and never a hard offset one.

## Shapes

Paper corners: almost everything rectangular uses a 6px radius (sheets, buttons, inputs, OTP cells, member plates, space icons, banners, toasts). Large member plates use 12px, bottom sheets 14px top corners, the segmented track 9px. Round forms are reserved for things you press with a thumb or that come from a rubber stamp: 44px answer controls, the 60px FAB, chips, the badge, and the 80px double-ringed stamp (2.5px outer ring, 1px inner ring at 4px inset, rotated -12deg). Original bills carry a 2px dashed perforation along the top edge; duplicates carry the same dashed top in their edge colour.

## Components

### Buttons
Firm, full-width, stationery-plain.
- **Shape:** paper corners (6px), 52px tall, 20px side padding, label at 600.
- **Primary:** carbon fill, white label; press scales to 0.98 and deepens to carbon-press.
- **Secondary:** sheet fill, carbon label, control-edge border; press tints carbon-wash.
- **Danger:** sheet fill, owe-red label, control-edge border.
- **Text button:** carbon label, 44px min height, no fill.
- **Disabled:** 40% opacity. Busy: an 18px ring spinner replaces the label.

### Answer Controls
The ✕ and ✓ pair on a pending bill: 44px circles, reject as a sheet-filled outline (control-edge border, faded ink icon), accept as a solid carbon disc. Press scales to 0.92. Icons are stroked SVG (1.75px stroke), never text glyphs.

### Chips
- **Style:** 44px pill, sheet fill, control-edge border, faded-ink label.
- **State:** selected fills carbon with white label; on fine pointers hover shifts the border to carbon.

### Cards / Containers
- **Corner Style:** 6px.
- **Background:** sheet on ground; sheet-2 when nested inside a bottom sheet (border removed).
- **Shadow Strategy:** none at rest (see Elevation & Depth).
- **Border:** 1px hairline; original bills add the 2px dashed perforation on top.
- **Internal Padding:** 12px for bills and rows, 16px for detail sheets.

### Inputs / Fields
- **Style:** 52px, sheet fill, 1px control-edge border, 6px corners, 14px side padding, carbon caret.
- **Focus:** border shifts to carbon (no glow).
- **Error:** border and helper text turn owe-red, helper at 600. Success helper is owed-green.
- **Amount field:** borderless 40px carbon figure over a 2px strong-hairline underline that turns carbon on focus.
- **OTP:** six 60px cells, 26px carbon digits; on error the row shakes ±6px.

### Navigation
Four-tab bar on the sheet colour with a hairline above: stroked 24px icon over a 13px/600 label. Inactive tabs are faded ink; the active tab is carbon with a 2px carbon indicator that scales in along the top edge. An owe-red 8px dot marks unread. Screens push like sheets pulled from a book: the new screen slides in from the right on the drawer curve while the old one shifts left 24% and dims to 0.6. Bottom sheets rise on the same curve.

### Ledger Rows
Rows live inside one sheet, divided by hairlines, min 68px: a 40px space icon or 32px member plate, the name over a faded serial or sub-line, and the amount right-aligned in owe/owed colour with a faded sub-line. Press tints carbon-wash.

### The Carbon Copy (signature)
A pending share is an original bill with its pink duplicate and yellow triplicate offset beneath it (a pending payment shows a single yellow copy). Accepting peels the copies down and to the right (to 22px/46px at 5deg, then 30px/58px at 7deg, fading, second copy 60ms later) while an AGREED or RECEIVED stamp presses down from 1.35x scale at -18deg to rest at -12deg over 220ms, with no overshoot. Rejecting tears the copies off down and to the left, and the stamp lands red (REJECTED / NOT RECEIVED). Fully agreed expenses keep an AGREED stamp; settled spaces show SETTLED. With reduced motion, copies and stamps crossfade.

### Rubber Stamp
80px circle, ink only (no fill), double ring, uppercase 12px/700 lettering at 0.12em, 0.88 opacity, rotated -12deg. Carbon for agreed/settled/received, stamp red for rejected. An inline variant (2px ring, -4deg) sits in text.

### Member Plates
32px squares (72px at 12px radius on profiles), filled with the person's fixed member colour and their initials at 700 in on-carbon, or their photo.

## Do's and Don'ts

### Do:
- **Do** put carbon (#23308A light, #A9BCFF dark) on every figure that sits in the total or detail views and on every primary action; keep owe/owed colours to balance direction.
- **Do** show anything awaiting an answer as an original sheet with its pink/yellow copies beneath, and remove the copies once it is answered.
- **Do** mark agreement, settlement and rejection with the round rubber stamp, pressed in 220ms on ease-out with no overshoot.
- **Do** keep sheets at 6px corners with a 1px hairline, and lists as one sheet of ruled rows.
- **Do** right-align amounts and use small-caps tracked serials (0.08em) for record numbers.
- **Do** compress pressed controls (0.92–0.98) over 120ms and stagger list entrances by 40ms; under reduced motion, crossfade instead.
- **Do** keep every touch target at least 44px.

### Don't:
- **Don't** use gradient balance cards, avatar walls or glassy, blurred dashboards.
- **Don't** use the duplicate pink or yellow as decoration on settled or static content.
- **Don't** add a second typeface or turn on Fraunces' WONK or SOFT axes.
- **Don't** animate numbers counting up or align amounts on the assumption of tabular digits.
- **Don't** fill buttons with owe-red or owed-green.
- **Don't** give flat paper (sheets, rows, inputs) a drop shadow or a hard offset shadow.
- **Don't** add uppercase eyebrow labels above titles; small caps belong to serials, month dividers and stamps only.
