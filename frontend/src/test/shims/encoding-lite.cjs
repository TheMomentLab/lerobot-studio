"use strict";

function getBOMEncoding(bytes) {
  if (!bytes || bytes.length < 2) return null;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return "utf-8";
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
  return null;
}

function labelToName(label) {
  if (typeof label !== "string") return null;
  const normalized = label.trim().toLowerCase();
  if (!normalized) return null;

  if (normalized === "utf8") return "UTF-8";
  if (normalized === "utf-8") return "UTF-8";
  if (normalized === "utf-16" || normalized === "utf-16le") return "UTF-16LE";
  if (normalized === "utf-16be") return "UTF-16BE";
  if (normalized === "iso-8859-1" || normalized === "latin1") return "windows-1252";
  if (normalized === "x-user-defined") return "x-user-defined";
  if (normalized === "windows-1252") return "windows-1252";
  return normalized;
}

module.exports = {
  getBOMEncoding,
  labelToName,
};
