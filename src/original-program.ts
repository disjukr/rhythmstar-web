/**
 * Constants decoded from relocated client.bin, not inferred from screenshots.
 * Addresses are retained so every translated value can be audited against the
 * original Thumb code and its data tables.
 */

// State 8: 0x10c3e8 loads the string at 0x131c04; 0x10c3f0 plays
// with repeat=1. State 9: 0x10c676 stops it, then 0x10c682/0x10c68a
// load the string at 0x131c1c and play with repeat=1.
export const BACKGROUND_MUSIC = {
  title: "res/Mmf/MarchChop.mmf",
  mainMenu: "res/Mmf/SpyOut.mmf",
} as const;

// 0x001342c0 is passed to the generic eight-player loader at 0x0010add8 by
// title initialization (0x0010c2f0). Zero means that player slot is unused.
export const TITLE_ANIMATIONS = [2, 3, 4, 5, 6, 7, 8] as const;

// The player stored at manager + 0x24 is created by 0x00108d50 from
// res/Vrp/MusicSelect_Title.vrp. State 8 selects animation 0 through
// 0x00108fbc before the seven state-owned title players are initialized.
// State 9 releases this player and loads MusicSelect1.vrp (0x1166e0).
export const COMMON_BACKGROUND_ANIMATION = 0;

// State 9 calls 0x00108fbc with selector 1. Its jump-table target at
// 0x00108fe6 selects animation 15 on the MusicSelect1 player. Animation 15
// is the nine-frame yellow-to-blue menu background sequence.
export const MENU_BACKGROUND_ANIMATION = 15;

// State 9 initializes the manager+0xdc particle object with type 1 at
// 0x0010c64e. 0x00109438 creates five players and 0x00109312 selects
// animation 38 for each one. Position updates do not advance those players,
// so state 9 renders the animation's initial white-star frame.
export const MENU_STAR_ANIMATION = 38;
export const MENU_STAR_COUNT = 5;

// 0x001344f4 is passed to the same loader by menu initialization at
// 0x0010c408. The selected-item player is separately initialized to 19 when
// entering from state 8.
export const MENU_BASE_ANIMATIONS = [17, 39, 16] as const;
export const MENU_INITIAL_ANIMATION = 19;

// Seven records at 0x001344a0. 0x0010c498 reads +0 as the destination state,
// +4 for a right move (key 0x67), and +8 for a left move (key 0x66).
export const MENU_ITEMS = [
  { state: 10, rightAnimation: 36, leftAnimation: 21 },
  { state: 11, rightAnimation: 20, leftAnimation: 22 },
  { state: 12, rightAnimation: 23, leftAnimation: 24 },
  { state: 13, rightAnimation: 25, leftAnimation: 26 },
  { state: 14, rightAnimation: 27, leftAnimation: 28 },
  { state: 15, rightAnimation: 29, leftAnimation: 30 },
  { state: 16, rightAnimation: 31, leftAnimation: 32 },
] as const;

// State 6 (0x0010a250) is one player with two consecutive non-looping
// animations. It creates animation 1, then 0x00125b9c changes the same player
// to animation 0, and only after that animation completes requests state 8.
// State 7 is an empty handler and is not the 3330 screen.
export const STARTUP_ANIMATIONS = {
  anbGames: 1,
  carrier3330: 0,
} as const;

// The state-6 render branch at 0x0010cd26 translates the graphics transform
// before entering the common bottom-up VRP renderer. On the 240x320 target
// this makes the VRP's centered coordinates relative to (120, 160).
export const STARTUP_ORIGIN = { x: 120, y: 160 } as const;

export const STARTUP_EFFECTS = [
  "res/Mmf/EffectMenuChange.mmf",
  "res/Mmf/EffectKeyChange.mmf",
  "res/Mmf/EffectWindowOpen.mmf",
  "res/Mmf/EffectGetItem.mmf",
  "res/Mmf/EffectStarChange.mmf",
  "res/Mmf/EffectMusicChange.mmf",
  "res/Mmf/EffectGameOver.mmf",
  "res/Mmf/EffectResult.mmf",
] as const;
