import React, { useEffect, useState, useRef } from 'react';
import { Synth, now, start } from 'tone';
import './App.css';

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

  // Define pentatonic scale frequencies (A minor pentatonic)
  const pentatonicNotes = [
    220.00,  // A3
    261.63,  // C4
    293.66,  // D4
    329.63,  // E4
    392.00,  // G4
    440.00,  // A4
    523.25,  // C5
    587.33,  // D5
    659.25,  // E5
    783.99   // G5
  ];

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

  const mapQuantityToNote = (quantity) => {
    // More sensitive scaling for different quantity ranges
    let index;
    if (quantity < 0.1) {
      // Very small orders: first two notes
      index = Math.floor(quantity * 20) % 2;
    } else if (quantity < 1) {
      // Small orders: first four notes
      index = Math.floor(quantity * 4) % 4;
    } else if (quantity < 10) {
      // Medium orders: middle range
      index = 2 + Math.floor(Math.log2(quantity) * 2);
    } else if (quantity < 100) {
      // Large orders: higher notes
      index = 5 + Math.floor(Math.log10(quantity));
    } else {
      // Very large orders: highest notes
      index = 8;
    }
    
    // Ensure index stays within bounds
    index = Math.max(0, Math.min(9, index));
    return pentatonicNotes[index];
  };

  const playTradeSound = (data) => {
    if (!synthRef.current) return;

    const currentTime = now();
    if (currentTime - lastPlayTime < 0.1) {
      return;
    }

    try {
      // Calculate new order quantities
      const newBidQty = getNewOrderQuantity(data.B, prevMarketData.B);
      const newAskQty = getNewOrderQuantity(data.A, prevMarketData.A);

      // Play sound only if there's a new order
      if (newBidQty > 0 || newAskQty > 0) {
        // Use the larger of the new orders for the note
        const quantity = Math.max(newBidQty, newAskQty);
        const frequency = mapQuantityToNote(quantity);
        
        // Keep volume constant for clarity
        const volume = -12;

        synthRef.current.triggerAttackRelease(frequency, '0.15', currentTime, Math.pow(10, volume/20));
        setLastPlayTime(currentTime);
      }

      // Update previous market data
      setPrevMarketData(data);
    } catch (error) {
      console.warn('Sound playback error:', error);
    }
  };

  useEffect(() => {
    let ws = null;
    let lastMessageTime = 0;

    const connectWebSocket = () => {
      if (!isPlaying) return;

      ws = new WebSocket(`wss://stream.binance.com:9443/ws/${selectedSymbol.toLowerCase()}@bookTicker`);
      
      ws.onmessage = (event) => {
        const currentTime = Date.now();
        // Reduce throttle time to hear more events
        if (currentTime - lastMessageTime < 100) {
          return;
        }
        lastMessageTime = currentTime;

        const data = JSON.parse(event.data);
        setMarketData(data);
        // Trigger flash animation
        if (data.b !== marketData.b) {
          setFlashBid(true);
          setTimeout(() => setFlashBid(false), 500);
        }
        if (data.a !== marketData.a) {
          setFlashAsk(true);
          setTimeout(() => setFlashAsk(false), 500);
        }
        playTradeSound(data);
      };
    };

    connectWebSocket();

    return () => {
      if (ws) {
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
            onChange={(e) => setSelectedSymbol(e.target.value)}
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