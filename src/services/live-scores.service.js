const axios = require('axios');
const { API_KEYS, SCORES_URLS } = require('../config/constants');
const { format } = require('date-fns');
const { utcToZonedTime } = require('date-fns-tz');
const StatsService = require('./stats.service');
const socketService = require('./socket.service');

class LiveScoresService {
  constructor() {
    this.activeGames = new Map();
    this.completedGames = new Set();
  }

  async fetchLiveScores(sport) {
    try {
      

        // Define the desired time zone (e.g., Eastern Time)
        const timeZone = 'America/New_York';

        // Convert current date to the desired time zone
        const zonedDate = utcToZonedTime(new Date(), timeZone);

        // Format the date
        const today = format(zonedDate, 'yyyy-MMM-dd').toUpperCase();
      const url = `${SCORES_URLS[sport]}/${"today"}`;
      
      const response = await axios.get(url, {
        headers: { "Ocp-Apim-Subscription-Key": API_KEYS[sport] }
      });

      return response.data;
    } catch (error) {
      console.error(`Error fetching ${sport} live scores:`, error);
      return [];
    }
  }

  async checkAndUpdateGames() {
    for (const sport of ["NHL", "NBA", "MLB", "NFL"]) {
      const games = await this.fetchLiveScores(sport);
      for (const game of games) {
        const gameId = `${sport}-${game.GameID}`;
        const isLive = game.Status === "InProgress";
        const isComplete = game.Status === "Final" || game.Status === "F/OT" || game.Status === "F/SO";
        
        // Add sport to game object
        game.sport = sport;
        
        // Handle live games
        if (isLive) {
          this.activeGames.set(gameId, game);
          // Emit live score update
          socketService.io?.emit('liveScore', { sport, game });
        }
        
        // Handle completed games
        if (isComplete && !this.completedGames.has(gameId)) {
          this.completedGames.add(gameId);
          this.activeGames.delete(gameId);
          
          // Refresh stats for the completed game's sport
          await StatsService.fetchAndSaveStats(sport);
          await socketService.broadcastUpdates();
        }
      }
    }
  }

  async startMonitoring() {
    // Check for games every 30 minutes
    setInterval(async () => {
      await this.checkAndUpdateGames();
    }, 30 * 60 * 1000);

    // Update live scores every minute if there are active games
    setInterval(async () => {
      if (this.activeGames.size > 0) {
        await this.checkAndUpdateGames();
      }
    }, 60 * 1000);

    // Initial check
    await this.checkAndUpdateGames();
  }

  getActiveGames() {
    return Array.from(this.activeGames.values());
  }
}

module.exports = new LiveScoresService();