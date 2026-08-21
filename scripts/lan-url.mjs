/**
 * Prints the URL another device on the LAN should open, before `next dev`
 * starts.
 *
 * Next reports `Network: https://0.0.0.0:3000` under `--hostname 0.0.0.0` —
 * the bind address, not anything you can type into a phone.
 */
import { printLan } from './lan.mjs';

printLan(process.env.PORT ?? '3000');
