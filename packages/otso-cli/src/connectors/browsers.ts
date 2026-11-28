import { chromiumHistory } from './local.js';

/**
 * More Chromium browsers. They keep history in the same format as Helium,
 * so each is one line: the folder it uses under ~/Library/Application Support.
 * Like Safari and Helium, each Mac writes its own <id>-<device> source.
 */
export const googleChrome = chromiumHistory('google-chrome', 'Google Chrome', 'Google/Chrome');
export const arc = chromiumHistory('arc', 'Arc', 'Arc/User Data');
export const dia = chromiumHistory('dia', 'Dia', 'Dia/User Data');
