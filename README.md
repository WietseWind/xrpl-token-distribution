# Distribute tokens (pub-sub like, in memory) on the XRPL

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


## Dev:

Run with DEBUG messages and live restart:
```
npm run dev
```

## Run (production)

Use e.g. pm2, or manually:
DEBUG=xrpldistr* node .
