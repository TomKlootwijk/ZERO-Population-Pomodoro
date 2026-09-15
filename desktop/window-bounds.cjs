'use strict';

const MARGIN = 12;

function isDocked(bounds, area) {
  return Math.abs(area.x + area.width - bounds.x - bounds.width - MARGIN) <= 20 &&
    Math.abs(area.y + area.height - bounds.y - bounds.height - MARGIN) <= 20;
}

// Keep the whole widget reachable, including on a monitor with negative coordinates.
function fitBounds(desired, area, previous, docked = false) {
  const margin = Math.min(MARGIN, Math.floor(Math.min(area.width, area.height) / 4));
  const width = Math.min(desired.width, Math.max(1, area.width - margin * 2));
  const height = Math.min(desired.height, Math.max(1, area.height - margin * 2));
  const minX = area.x + margin, minY = area.y + margin;
  const maxX = area.x + area.width - width - margin;
  const maxY = area.y + area.height - height - margin;
  return {
    x: Math.round(docked || !previous ? maxX : Math.max(minX, Math.min(maxX, previous.x))),
    y: Math.round(docked || !previous ? maxY : Math.max(minY, Math.min(maxY, previous.y))),
    width: Math.round(width), height: Math.round(height)
  };
}

module.exports = { fitBounds, isDocked };
