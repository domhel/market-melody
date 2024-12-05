import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Synth, now, start } from 'tone';
import './App.css';

// Define pentatonic scale frequencies (A minor pentatonic)
const pentatonicNotes = [
  146.83,  // D3
  165.00,  // E3
  196.00,  // G3
  220.00,  // A3
  261.63,  // C4
  293.66,  // D4
  329.63,  // E4
  392.00,  // G4
  440.00,  // A4
  523.25,  // C5
  587.33,  // D5
  659.25,  // E5
  783.99,  // G5
  880.00,  // A5
  1046.50  // C6
];

const MAX_HISTORY_SIZE = 100; // Maximum number of data points to keep
const MIDDLE_NOTE_INDEX = Math.floor(pentatonicNotes.length / 2);
const MIN_TIME_BETWEEN_SOUNDS = 0.25; // Increase minimum time between sounds to 250ms

function App() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState('BTCUSDT');
  const [marketData, setMarketData] = useState({ b: '0', B: '0', a: '0', A: '0' });
  const [flashBid, setFlashBid] = useState(false);
  const [flashAsk, setFlashAsk] = useState(false);
  const [lastPlayTime, setLastPlayTime] = useState(0);
  const [prevMarketData, setPrevMarketData] = useState({ b: '0', B: '0', a: '0', A: '0' });
  const synthRef = useRef(null);
  const [theme, setTheme] = useState(() => {
    // Check localStorage first
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) return savedTheme;
    
    // Then check system preference
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
    return 'light';
  });
  const [quantityHistory, setQuantityHistory] = useState({
    bids: [],
    asks: []
  });
  const statsRef = useRef({
    bids: { mean: 0, stdDev: 0 },
    asks: { mean: 0, stdDev: 0 }
  });
  const [playBidNext, setPlayBidNext] = useState(true);

  // Listen for system theme changes
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e) => {
      const savedTheme = localStorage.getItem('theme');
      if (!savedTheme) {
        setTheme(e.matches ? 'dark' : 'light');
      }
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  // Update theme class on body and save to localStorage
  useEffect(() => {
    document.body.className = theme;
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };

  // Initialize synth when starting
  const initializeSynth = () => {
    if (!synthRef.current) {
      synthRef.current = new Synth({
        envelope: {
          attack: 0.005,
          decay: 0.1,
          sustain: 0.3,
          release: 0.1
        },
        oscillator: {
          type: 'sine'
        },
        volume: -6
      }).toDestination();
    }
  };

  // Cleanup synth on unmount
  useEffect(() => {
    return () => {
      if (synthRef.current) {
        synthRef.current.dispose();
        synthRef.current = null;
      }
    };
  }, []);

  const getNewOrderQuantity = (currentQty, prevQty) => {
    const current = parseFloat(currentQty);
    const prev = parseFloat(prevQty);
    // If quantity increased, return the difference
    if (current > prev) {
      return current - prev;
    }
    // If quantity decreased or stayed same, return 0
    return 0;
  };

  const processMarketData = (newData, prevData) => {
    const newBidQty = getNewOrderQuantity(newData.B, prevData.B);
    const newAskQty = getNewOrderQuantity(newData.A, prevData.A);
    
    let orderUpdate = null;
    
    if (newBidQty > 0 || newAskQty > 0) {
      const isBid = newBidQty > newAskQty;
      const quantity = isBid ? newBidQty : newAskQty;
      
      orderUpdate = {
        type: isBid ? 'bids' : 'asks',
        quantity,
        price: isBid ? newData.b : newData.a
      };
    }
    
    return {
      orderUpdate,
      priceUpdates: {
        bidChanged: newData.b !== prevData.b,
        askChanged: newData.a !== prevData.a
      }
    };
  };

  const handleOrderUpdate = (orderUpdate, updateStats, playSound) => {
    if (!orderUpdate) return;
    
    const { type, quantity } = orderUpdate;
    const isBid = type === 'bids';
    
    // Update statistics
    updateStats(quantity, isBid);
    
    // Play sound
    playSound(quantity, isBid);
  };

  const updateStats = useCallback((newQuantity, isBid) => {
    setQuantityHistory(prev => {
      const type = isBid ? 'bids' : 'asks';
      const newHistory = {
        ...prev,
        [type]: [...prev[type], newQuantity].slice(-MAX_HISTORY_SIZE)
      };
      
      const currentHistory = newHistory[type];
      
      // Calculate mean
      const mean = currentHistory.reduce((sum, val) => sum + val, 0) / currentHistory.length;
      
      // Calculate standard deviation
      const variance = currentHistory.reduce((sum, val) => {
        const diff = val - mean;
        return sum + (diff * diff);
      }, 0) / currentHistory.length;
      const stdDev = Math.sqrt(variance);

      statsRef.current[type] = { mean, stdDev };
      console.log(`${type.toUpperCase()} Stats updated - Mean: ${mean.toFixed(2)}, StdDev: ${stdDev.toFixed(2)}, Current Qty: ${newQuantity.toFixed(2)}`);
      return newHistory;
    });
  }, []);

  const mapQuantityToNote = (quantity, isBid) => {
    const type = isBid ? 'bids' : 'asks';
    const stats = statsRef.current[type];
    
    // If we don't have enough data yet, use middle of appropriate half
    if (quantityHistory[type].length < 2) {
      if (isBid) {
        return pentatonicNotes[Math.floor(pentatonicNotes.length * 0.75)]; // Middle of upper half
      } else {
        return pentatonicNotes[Math.floor(pentatonicNotes.length * 0.25)]; // Middle of lower half
      }
    }

    // Calculate z-score
    const zScore = (quantity - stats.mean) / (stats.stdDev || 1);
    // Clamp z-score to reasonable range (-2 to 2)
    const clampedZScore = Math.max(-2, Math.min(2, zScore));
    
    // Map z-score to [0,1] range for the appropriate half
    const normalized = (clampedZScore + 2) / 4; // Maps [-2,2] to [0,1]
    
    // Calculate index based on whether it's a bid or ask
    let index;
    const halfLength = Math.floor(pentatonicNotes.length / 2);
    
    if (isBid) {
      // Bids use upper half (map normalized to [halfLength, length-1])
      index = halfLength + Math.floor(normalized * (pentatonicNotes.length - halfLength));
    } else {
      // Asks use lower half (map normalized to [0, halfLength-1])
      index = Math.floor(normalized * halfLength);
    }
    
    // Ensure index stays within bounds
    index = Math.max(isBid ? halfLength : 0, 
                    Math.min(isBid ? pentatonicNotes.length - 1 : halfLength - 1, index));
    
    console.log(`${type.toUpperCase()} Note mapping - Quantity: ${quantity.toFixed(2)}, Z-Score: ${zScore.toFixed(2)}, Normalized: ${normalized.toFixed(2)}, Index: ${index}, StdDev: ${stats.stdDev.toFixed(2)}`);
    return pentatonicNotes[index];
  };

  const playSound = (quantity, isBid, currentTime) => {
    if (!synthRef.current || (currentTime - lastPlayTime < MIN_TIME_BETWEEN_SOUNDS)) {
      return false;
    }

    try {
      const frequency = mapQuantityToNote(quantity, isBid);
      const volume = -12;
      synthRef.current.triggerAttackRelease(frequency, '0.15', currentTime, Math.pow(10, volume/20));
      setLastPlayTime(currentTime);
      return true;
    } catch (error) {
      console.warn('Sound playback error:', error);
      return false;
    }
  };

  const handleSymbolChange = (newSymbol) => {
    // Reset statistics and history for the new symbol
    setQuantityHistory({
      bids: [],
      asks: []
    });
    statsRef.current = {
      bids: { mean: 0, stdDev: 0 },
      asks: { mean: 0, stdDev: 0 }
    };
    setPrevMarketData({ b: '0', B: '0', a: '0', A: '0' });
    setMarketData({ b: '0', B: '0', a: '0', A: '0' });
    setSelectedSymbol(newSymbol);
  };

  useEffect(() => {
    let ws = null;
    let lastMessageTime = 0;
    let isSubscribed = false;

    const connectWebSocket = () => {
      if (!isPlaying) return;

      // Close existing connection if any
      if (ws) {
        ws.close();
        ws = null;
      }

      ws = new WebSocket(`wss://stream.binance.com:9443/ws/${selectedSymbol.toLowerCase()}@bookTicker`);
      
      ws.onopen = () => {
        console.log(`WebSocket connected for ${selectedSymbol}`);
        isSubscribed = true;
      };

      ws.onclose = () => {
        console.log(`WebSocket disconnected for ${selectedSymbol}`);
        isSubscribed = false;
      };

      ws.onerror = (error) => {
        console.error(`WebSocket error for ${selectedSymbol}:`, error);
        isSubscribed = false;
      };
      
      ws.onmessage = (event) => {
        const currentTime = Date.now();
        if (currentTime - lastMessageTime < 100) {
          return;
        }
        lastMessageTime = currentTime;

        const data = JSON.parse(event.data);
        
        // 1. Update UI with current data
        setMarketData(data);
        
        // 2. Process order quantities and update stats
        const newBidQty = getNewOrderQuantity(data.B, prevMarketData.B);
        const newAskQty = getNewOrderQuantity(data.A, prevMarketData.A);
        
        // Update flash animations for price changes
        if (data.b !== prevMarketData.b) {
          setFlashBid(true);
          setTimeout(() => setFlashBid(false), 500);
        }
        if (data.a !== prevMarketData.a) {
          setFlashAsk(true);
          setTimeout(() => setFlashAsk(false), 500);
        }

        // 3. Process both bid and ask updates
        const currentToneTime = now();
        
        // Always update statistics for both if they have updates
        if (newBidQty > 0) {
          console.log('New bid quantity:', newBidQty, 'Previous:', prevMarketData.B, 'Current:', data.B);
          updateStats(newBidQty, true);
        }
        if (newAskQty > 0) {
          console.log('New ask quantity:', newAskQty, 'Previous:', prevMarketData.A, 'Current:', data.A);
          updateStats(newAskQty, false);
        }

        // Play sound for one of them based on alternating pattern
        if (newBidQty > 0 || newAskQty > 0) {
          if (newBidQty > 0 && newAskQty > 0) {
            // Both have updates, use alternating pattern
            if (playBidNext) {
              playSound(newBidQty, true, currentToneTime);
            } else {
              playSound(newAskQty, false, currentToneTime);
            }
            setPlayBidNext(!playBidNext);
          } else {
            // Only one has an update, play that one
            if (newBidQty > 0) {
              playSound(newBidQty, true, currentToneTime);
            } else {
              playSound(newAskQty, false, currentToneTime);
            }
          }
        }

        setPrevMarketData(data);
      };
    };

    connectWebSocket();

    return () => {
      if (ws) {
        isSubscribed = false;
        ws.close();
      }
    };
  }, [isPlaying, selectedSymbol]);

  const handleStartStop = async () => {
    try {
      if (!isPlaying) {
        await start();
        initializeSynth();
        console.log('Audio started');
      } else {
        if (synthRef.current) {
          synthRef.current.dispose();
          synthRef.current = null;
        }
      }
      setIsPlaying(!isPlaying);
    } catch (error) {
      console.error('Error starting audio:', error);
    }
  };

  return (
    <div className={`App ${theme}`}>
      <header className="App-header">
        <div className="logo-container">
          <span className="app-logo">♫</span>
          <span className="logo-text">MarketMelody</span>
          <button 
            className="theme-toggle" 
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
        </div>
        <div className="controls">
          <select 
            value={selectedSymbol}
            onChange={(e) => handleSymbolChange(e.target.value)}
          >
            <optgroup label="USDT Pairs">
              <option value="BTCUSDT">Bitcoin (BTC/USDT)</option>
              <option value="ETHUSDT">Ethereum (ETH/USDT)</option>
              <option value="BNBUSDT">Binance Coin (BNB/USDT)</option>
              <option value="SOLUSDT">Solana (SOL/USDT)</option>
              <option value="XRPUSDT">Ripple (XRP/USDT)</option>
              <option value="ADAUSDT">Cardano (ADA/USDT)</option>
              <option value="DOGEUSDT">Dogecoin (DOGE/USDT)</option>
              <option value="MATICUSDT">Polygon (MATIC/USDT)</option>
              <option value="DOTUSDT">Polkadot (DOT/USDT)</option>
              <option value="AVAXUSDT">Avalanche (AVAX/USDT)</option>
              <option value="LINKUSDT">Chainlink (LINK/USDT)</option>
              <option value="ATOMUSDT">Cosmos (ATOM/USDT)</option>
              <option value="UNIUSDT">Uniswap (UNI/USDT)</option>
              <option value="SHIBUSDT">Shiba Inu (SHIB/USDT)</option>
              <option value="LTCUSDT">Litecoin (LTC/USDT)</option>
              <option value="NEARUSDT">NEAR Protocol (NEAR/USDT)</option>
              <option value="AAVEUSDT">Aave (AAVE/USDT)</option>
              <option value="ALGOUSDT">Algorand (ALGO/USDT)</option>
              <option value="APTUSDT">Aptos (APT/USDT)</option>
              <option value="FILUSDT">Filecoin (FIL/USDT)</option>
            </optgroup>
            <optgroup label="BTC Pairs">
              <option value="ETHBTC">Ethereum (ETH/BTC)</option>
              <option value="BNBBTC">Binance Coin (BNB/BTC)</option>
              <option value="SOLBTC">Solana (SOL/BTC)</option>
              <option value="XRPBTC">Ripple (XRP/BTC)</option>
              <option value="ADABTC">Cardano (ADA/BTC)</option>
              <option value="DOGEBTC">Dogecoin (DOGE/BTC)</option>
              <option value="DOTBTC">Polkadot (DOT/BTC)</option>
              <option value="LINKBTC">Chainlink (LINK/BTC)</option>
            </optgroup>
            <optgroup label="ETH Pairs">
              <option value="BNBETH">Binance Coin (BNB/ETH)</option>
              <option value="SOLETH">Solana (SOL/ETH)</option>
              <option value="LINKETH">Chainlink (LINK/ETH)</option>
              <option value="MATICETH">Polygon (MATIC/ETH)</option>
              <option value="ATOMETH">Cosmos (ATOM/ETH)</option>
              <option value="AVAXETH">Avalanche (AVAX/ETH)</option>
              <option value="AAVEETH">Aave (AAVE/ETH)</option>
            </optgroup>
            <optgroup label="BNB Pairs">
              <option value="SOLBNB">Solana (SOL/BNB)</option>
              <option value="ADABNB">Cardano (ADA/BNB)</option>
              <option value="DOTBNB">Polkadot (DOT/BNB)</option>
              <option value="MATICBNB">Polygon (MATIC/BNB)</option>
              <option value="ATOMBNB">Cosmos (ATOM/BNB)</option>
            </optgroup>
            <optgroup label="BUSD Pairs">
              <option value="BTCBUSD">Bitcoin (BTC/BUSD)</option>
              <option value="ETHBUSD">Ethereum (ETH/BUSD)</option>
              <option value="BNBBUSD">Binance Coin (BNB/BUSD)</option>
              <option value="SOLBUSD">Solana (SOL/BUSD)</option>
              <option value="ADABUSD">Cardano (ADA/BUSD)</option>
            </optgroup>
          </select>
          <button onClick={handleStartStop}>
            {isPlaying ? 'Stop' : 'Start'} Market Music
          </button>
        </div>
        
        {isPlaying && (
          <div className="market-display">
            <div className={`price-column bid-column ${flashBid ? 'flash' : ''}`}>
              <h3>Bid</h3>
              <div className="price">{parseFloat(marketData.b).toFixed(2)}</div>
              <div className="quantity">Qty: {parseFloat(marketData.B).toFixed(2)}</div>
            </div>
            <div className={`price-column ask-column ${flashAsk ? 'flash' : ''}`}>
              <h3>Ask</h3>
              <div className="price">{parseFloat(marketData.a).toFixed(2)}</div>
              <div className="quantity">Qty: {parseFloat(marketData.A).toFixed(2)}</div>
            </div>
          </div>
        )}

      </header>
    </div>
  );
}

export default App; 