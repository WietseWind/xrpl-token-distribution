# Distribute tokens on the XRPL
#### HTTP backend to compose, sign & submit

This simple node backend allows for validating, composing, signing and
submitting transactions to run a token faucet on the XRP Ledger.

**WARNING! THERE IS NO PROTECTION WHATSOEVER AGAINST HAMMERING THIS ENDPOINT
AND OBTAINING A LOT OF FUNDS! THERE MUST BE PROPER SECURITY AND VALIDATION
IN PLACE BEFORE THIS ENDPOINT IS HIT**

## Configuration

This package uses `dotenv` to fetch the configuration from a `.env` file. A sample
file with all available options is avaialble in `.env.sample`.

The following options are available:

- `node="wss://xrplcluster.com"` (default: wss://xrplcluster.com)  
  The XRPL node to connect to (change to e.g. testnet or your own node)
- `account="rAAAAAAAA"`  
  The Faucet account
- `familyseed="sBBBBBBB"`  
  The Family Seed (secret) to the Faucet account
- `issuer="rXXXXXXXX"`  
  The token issuer account (the token to distribute, the Faucet account must hold this token)
- `token="ABC"`  
  The token code (3 char or HEX)
- `maxledgers=10` (default: 10)  
  The max. ledgers in the future the faucet transaction is valid (time out in case of e.g. fee escalation)
- `memo="Faucet, enjoy 🎉"`  
  Optional: UTF-8 message to include in every transaction (text, on ledger Memo, public!)
- `feedrops=13` (default: 20, max 1000)  
  The amount of drops transaction fee
- `localtxttl=60` (default: 60)  
  The amount of seconds the same destination account cannot claim any more
- `secperqueueprocess=15` (default: 15)
  The seconds between processing a queued payout
- `txsperledger=5` (default: 5)  
  The amount of transactions to include (max) from the queue in one ledger

## Distribute & Status (endpoints)

When this app is running (see Dev & Run chapters below), two endpoints are available:

#### `/{account}/{amount}`

Distribute `{amount}` to `{account}`

##### Returns (OK): 
```javascript
{
  "send": {...},
  "faucet": {...},
  "transaction": {...},
  "txhash": "CAFEBABE..."
}
```

##### Returns (Error):
```javascript
{
  "error": "Some error message"
}
```

#### `/status`

Shows the current objects (not yet cleaned because of reaching the `localtxttl`) and their state and XRPL submit response.

## Dev:

Run with DEBUG messages and live restart:
```
npm run dev
```

## Run (production)

#### Run manually:
```
DEBUG=xrpldistr* node .
```

#### Run (or reload) with PM2:
```
npm run pm2
```
