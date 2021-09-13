const express = require('express')
const assert = require('assert')
const config = require('dotenv').config().parsed
const log = require('debug')('xrpldistr')
const logReq = log.extend('req')
const app = express()
const { XrplClient } = require('xrpl-client')
const { derive, sign } = require('xrpl-accountlib')

assert(config?.account, 'Config (account) missing')
assert(config?.familyseed, 'Config (familyseed) missing')
assert(config?.issuer, 'Config (issuer) missing')
assert(config?.token, 'Config (token) missing')

log(`Distributing\n > ${config.token}\nby\n > ${config.issuer}\nfrom\n > ${config.account}`)

const recent = {}
const queue = {}

setInterval(() => {
  const keys = Object.keys(queue).filter(q => typeof queue[q].processing === 'undefined')
  log('Processing queue')

  if (keys.length > 0) {
    const item = queue[keys[0]]
    log('Queue processing', keys[0])
    Object.assign(item, { processing: true })
    processPayout(item)
  } else {
    log('Queue empty')
  }
}, 5000)

const processPayout = async (queueItem) => {
  let xrpl
  const { account, amount, verbose } = queueItem

  Object.assign(recent, { [account]: verbose })

  setTimeout(() => {
    if (Object.keys(recent).indexOf(account) > -1) {
      delete recent[account]
    }
  }, Number(config?.localtxttl || 60) * 1000)

  try {

    xrpl = await new XrplClient(config?.node || 'wss://xrplcluster.com', {
      assumeOfflineAfterSeconds: 20,
      maxConnectionAttempts: 4,
      connectAttemptTimeoutSeconds: 4,
    })

    xrpl.on('clusterinfo', i => log(`Connected to FH server: ${i.preferredServer}`))
    
    xrpl.on('online', () => {
      log('XRPL connection ready',
        xrpl.getState().server.uri,
        xrpl.getState().server.publicKey
      )
    })

    xrpl.on('close', () => {
      log('XRPL connection closed')
    })

    // 7. Check if the faucet account has enough funds (and fetch some data for the TX)
    const faucetAccountInfo = await xrpl.send({ command: 'account_info', account: config.account })
    const faucetLineBalance = await xrpl.send({ command: 'gateway_balances', account: config.account })

    assert(Object.keys(faucetLineBalance?.assets || {}).indexOf(config.issuer) > -1, `Faucet account doesn't hold tokens by issuer ${config.issuer}`)
    const assetFaucet = faucetLineBalance.assets[config.issuer].filter(a => a.currency === config.token)
    assert(assetFaucet.length === 1, `Faucet account doesn't hold token ${config.token} by issuer ${config.issuer}`)

    const faucetBalance = Number(assetFaucet[0].value)

    Object.assign(verbose.faucet, { balance: faucetBalance, sequence: faucetAccountInfo?.account_data?.Sequence })

    const Memos = config?.memo
      ? {
        Memos: [
          {
            Memo: {
              MemoData: Buffer.from(String(config.memo).trim(), 'utf8').toString('hex').toUpperCase()
            }
          }
        ]
      }
      : {}

    // 8. Compose & sign a transaction
    await xrpl.ready()
    // We need to wait so we know the last ledger

    const transaction = {
      TransactionType: 'Payment',
      Account: config.account,
      Destination: account,
      Amount: {
        issuer: config.issuer,
        currency: config.token,
        value: String(amount)
      },
      Fee: String(Math.min(config?.feedrops || 20, 1000)),
      Sequence: faucetAccountInfo?.account_data?.Sequence,
      LastLedgerSequence: xrpl.getState().ledger.last + Number(config?.maxledgers || 10),
      ...Memos
    }

    const signed = sign(transaction, derive.familySeed(config.familyseed))

    Object.assign(verbose, { transaction, txhash: signed.id })

    logReq('Processing', verbose)

    // 9. Submit the transaction
    logReq('Submitting transaction', signed.id)
    const submit = await xrpl.send({ command: 'submit', tx_blob: signed.signedTransaction })

    if (Object.keys(recent).indexOf(account) > -1) {
      Object.assign(recent[account], { submit })
    }

    logReq('TX Submit response', signed.id, submit)
  } catch (e) {
    log(e.message)
  }

  if (typeof xrpl !== 'undefined') {
    log('Closing...')
    await xrpl.ready()
    xrpl.close()
    log('Closed')

    delete queue[account]
    xrpl = undefined
  }

  return
}

const main = async () => {
  app.get('/:account(r[a-zA-Z0-9]{16,})/:amount([0-9.]{1,})', async (req, res) => {
    let xrpl

    try {
      const account = req.params.account
      const amount = Number(req.params.amount)

      assert(Object.keys(recent).indexOf(account) < 0, `This account has recently received (or attempted to receive) ${config.token}. Please wait.`)

      log('Connecting to the XRPL...')

      xrpl = await new XrplClient(config?.node || 'wss://xrplcluster.com', {
        assumeOfflineAfterSeconds: 20,
        maxConnectionAttempts: 4,
        connectAttemptTimeoutSeconds: 4,
      })

      xrpl.on('clusterinfo', i => log(`Connected to FH server: ${i.preferredServer}`))
    
      xrpl.on('online', () => {
        log('XRPL connection ready',
          xrpl.getState().server.uri,
          xrpl.getState().server.publicKey
        )
      })

      const verbose = {
        send: {
          account,
          amount
        },
        faucet: {}
      }

      logReq('Processing', verbose.send)

      // 1. Check if account exists (activated)
      const accountInfo = await xrpl.send({ command: 'account_info', account })

      if (!accountInfo?.account_data?.Account) {
        throw new Error(`Account doesn't exist (invalid or not activated)`)
      }

      // 2. Check if Trust Line exists
      const accountLines = await xrpl.send({ command: 'account_lines', account })
      if (!Array.isArray(accountLines?.lines)) {
        throw new Error(`Account doesn't have any Trust Lines setup`)
      }
      const matchingLine = accountLines?.lines.filter(a => a.account === config.issuer && a.currency === config.token)

      // 4. Check if the right Trust Line is present
      if (matchingLine.length < 1) {
        throw new Error(`Account does have Trust Lines, but not one for token ${config.token} by issuer ${config.issuer}`)
      }

      if (matchingLine.length > 0) {
        // 5. check if the Limit is OK for the Trust Line
        if (matchingLine[0].limit === '0') {
          throw new Error(`Trust Line to for token ${config.token} by issuer ${config.issuer} has limit 0 (zero)`)
        }

        // 6. Check if the amount to be sent doesn't exceed the limit
        const balance = Number(matchingLine[0].balance)
        if (balance + amount > Number(matchingLine[0].limit)) {
          throw new Error(`Trust Line limit (${matchingLine[0].limit}) is lower than the current ${config.token} balance (${balance} + amount to send (${amount}))`)
        }

        Object.assign(verbose.send, { balance })
      }

      // Answer the Web Client
      res.json(verbose)
      
      Object.assign(queue, { [account]: { account, amount, verbose } })
    } catch (e) {
      res.json({ error: e.message })
    }

    if (typeof xrpl !== 'undefined') {
      log('Closing...')
      await xrpl.ready()
      xrpl.close()
      log('Closed')
      xrpl = undefined
    }

    return
  })

  app.get('/status', async (req, res) => {
    res.json(recent)
  })

  app.get('/queue', async (req, res) => {
    res.json(queue)
  })
      
  log('Listening at :3000')
  app.listen(3000)
}

log('Starting app...')
main()
