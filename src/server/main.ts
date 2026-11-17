/**
 * Apps Script entry point. Every export becomes a top-level global function in
 * the built Code.js (see scripts/build.mjs), callable via google.script.run or
 * as a trigger handler. Nothing here may touch Apps Script services at import
 * time.
 */
import type { BootstrapData } from '../shared/types';
import * as api from './api';
import { runWorker, WORKER } from './automation';
import { toRpcError } from './errors';
import { triggers } from './gas';
import { log } from './log';
import { job, rpc } from './rpc';
import { flushActivity, resetRequestState, SCHEMA_VERSION } from './store/db';
import { workspaceReady } from './store/records';

/** JSON that is safe to place inside an inline <script>. */
function scriptSafeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function doGet(): GoogleAppsScript.HTML.HtmlOutput {
  resetRequestState();
  let data: BootstrapData | null = null;
  let error = '';
  // First-run setup (creating the sheet, catalogues, seed data) can take a minute on real
  // Sheets. Never block the page on it: send the page now and let the client run setup
  // through google.script.run, with a visible "setting up" message.
  if (workspaceReady(SCHEMA_VERSION)) {
    try {
      data = api.bootstrap();
    } catch (e) {
      error = toRpcError(e, 'doGet').message;
      log.error('doGet.bootstrap_failed', { message: String(e) });
    } finally {
      flushActivity();
    }
  }
  const page = HtmlService.createHtmlOutputFromFile('index').getContent();
  // Function replacer: a string replacement would interpret "$&" etc. inside the JSON.
  const html = page.replace('"__IIP_BOOT__"', () => scriptSafeJson({ data, error }));
  return HtmlService.createHtmlOutput(html)
    .setTitle('InternIQ · internship intelligence')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

export const bootstrap = rpc('bootstrap', api.bootstrap);
export const saveProfile = rpc('saveProfile', api.saveProfile, { perMinute: 20 });
export const saveSettings = rpc('saveSettings', api.saveSettings, { perMinute: 30 });
export const completeOnboarding = rpc('completeOnboarding', api.completeOnboarding);
export const setSecret = rpc('setSecret', api.setSecret, { perMinute: 6 });
export const clearSecret = rpc('clearSecret', api.clearSecret);
export const listModels = rpc('listModels', api.listModels, { perMinute: 10 });
export const testAi = rpc('testAi', api.testAi, { perMinute: 4 });
export const getUsage = rpc('getUsage', api.getUsage);
export const listJobs = rpc('listJobs', api.listJobs);
export const getJob = rpc('getJob', api.getJob, { perMinute: 60 });
export const createJob = rpc('createJob', api.createJob, { perMinute: 30 });
export const updateJob = rpc('updateJob', api.updateJob, { perMinute: 120 });
export const bulkUpdate = rpc('bulkUpdate', api.bulkUpdate, { perMinute: 30 });
export const deleteJobs = rpc('deleteJobs', api.deleteJobs, { perMinute: 30 });
export const refreshNow = rpc('refreshNow', api.refreshNow, { perMinute: 3 });
export const addFromUrl = rpc('addFromUrl', api.addFromUrl, { perMinute: 15 });
export const analyzeWithAi = rpc('analyzeWithAi', api.analyzeWithAi, { perMinute: 10 });
export const rescoreAll = rpc('rescoreAll', api.rescoreAll, { perMinute: 4 });
export const generateCoverLetter = rpc('generateCoverLetter', api.generateCoverLetter, { perMinute: 8 });
export const saveCoverLetter = rpc('saveCoverLetter', api.saveCoverLetter, { perMinute: 60 });
export const importTsv = rpc('importTsv', api.importTsv, { perMinute: 6 });
export const importStarterPack = rpc('importStarterPack', api.importStarterPack, { perMinute: 3 });
export const importFromSheet = rpc('importFromSheet', api.importFromSheet, { perMinute: 3 });
export const resolveBoard = rpc('resolveBoard', api.resolveBoard, { perMinute: 15 });
export const getActivity = rpc('getActivity', api.getActivity);
export const deleteAllData = rpc('deleteAllData', api.deleteAllData, { perMinute: 2 });
export const updateProgram = rpc('updateProgram', api.updateProgram, { perMinute: 120 });
export const createProgram = rpc('createProgram', api.createProgram, { perMinute: 30 });
export const deleteProgram = rpc('deleteProgram', api.deleteProgram, { perMinute: 30 });
export const updateExam = rpc('updateExam', api.updateExam, { perMinute: 120 });
export const createExam = rpc('createExam', api.createExam, { perMinute: 30 });
export const deleteExam = rpc('deleteExam', api.deleteExam, { perMinute: 30 });
export const refreshCatalogs = rpc('refreshCatalogs', api.refreshCatalogs, { perMinute: 4 });
export const createTask = rpc('createTask', api.createTask, { perMinute: 60 });
export const updateTask = rpc('updateTask', api.updateTask, { perMinute: 120 });
export const deleteTask = rpc('deleteTask', api.deleteTask, { perMinute: 60 });
export const scanMail = rpc('scanMail', api.scanMail, { perMinute: 4 });
export const mailAction = rpc('mailAction', api.mailAction, { perMinute: 120 });

/** Hourly time-driven trigger (installed per user when automation is on). */
export const worker = job(WORKER, runWorker);

/** v1 installed a daily trigger with this name; retire it and hand over to the v2 worker. */
export const aggregateJobsDailyFlow = job('aggregateJobsDailyFlow', () => {
  triggers.removeAll('aggregateJobsDailyFlow');
  runWorker();
});
