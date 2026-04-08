// AXIS — Logger
// Audit trail for all AXIS actions

const logs = []; // In-memory for edge runtime

export async function log(entry) {
  try {
    const logEntry = {
      ...entry,
      timestamp: entry.timestamp || new Date().toISOString()
    };
    
    logs.push(logEntry);
    
    // Keep only last 100 logs in memory
    if (logs.length > 100) logs.shift();
    
    console.log(`[AXIS LOG] ${logEntry.type}:`, JSON.stringify(logEntry));
  } catch (err) {
    console.error('Logger failed:', err);
  }
}

export function getLogs(limit = 20) {
  return logs.slice(-limit);
}
