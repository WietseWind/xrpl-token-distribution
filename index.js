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

let processing = false
let claimCount = 0

setInterval(async ()  => {
  let xrpl

  try {
    log('Process?')

    if (!processing) {
      log('Yes, process, not yet processing...')
      processing = true

      const keys = Object.keys(queue).filter(q => typeof queue[q].processing === 'undefined')
      log('Processing queue')

      if (keys.length > 0) {
        log('Processing, queue length', keys.length)
        log('Connecting <PROCESSING>')

        xrpl = await new XrplClient(config?.node || 'wss://xrplcluster.com', {
          assumeOfflineAfterSeconds: 20,
          maxConnectionAttempts: 4,
          connectAttemptTimeoutSeconds: 4,
        })
    
        xrpl.on('clusterinfo', i => log(`Connected to FH server: ${i.preferredServer}`))

        // 7. Check if the faucet account has enough funds (and fetch some data for the TX)
        const faucetAccountInfo = await xrpl.send({ command: 'account_info', account: config.account })
        const faucetLineBalance = await xrpl.send({ command: 'gateway_balances', account: config.account })

        assert(Object.keys(faucetLineBalance?.assets || {}).indexOf(config.issuer) > -1, `Faucet account doesn't hold tokens by issuer ${config.issuer}`)
        const assetFaucet = faucetLineBalance.assets[config.issuer].filter(a => a.currency === config.token)
        assert(assetFaucet.length === 1, `Faucet account doesn't hold token ${config.token} by issuer ${config.issuer}`)

        const faucetBalance = Number(assetFaucet[0].value)
        log('faucetBalance', faucetBalance)
        
        xrpl.on('online', () => {
          log('XRPL connection ready',
            xrpl.getState().server.uri,
            xrpl.getState().server.publicKey
          )
        })
    
        xrpl.on('close', () => {
          log('XRPL connection closed')
        })

        log('Waiting for XPRL connection to be fully ready')
        await xrpl.ready()
        log('XRPL connection Ready <PROCESSING>')

        const keysToProcess = keys.slice(0, Number(config?.txsperledger || 5))
        await Promise.all(keysToProcess.map(async (k, i) => {
          const item = queue[k]
          Object.assign(item, { processing: true })
          log('Queue processing', k)

          await processPayout(k, item, xrpl, faucetAccountInfo?.account_data?.Sequence + i, Memos)
          log('Done processing', k)

          return
        }))

        processing = false
        log('Done processing (OVERALL)')
      } else {
        log('Queue empty')
      }
    } else {
      log('Skip processing, still processing!')
    }
  } catch (e) {
    log('Processing interval error', e?.message, e)
  }

  if (typeof xrpl !== 'undefined') {
    log('Closing... <PROCESSING>')
    await xrpl.ready()
    xrpl.close()
    log('Closed <PROCESSING>')
    xrpl = undefined
  }

  processing = false
}, Number(config?.secperqueueprocess || 15) * 1000)

const processPayout = async (k, queueItem, xrpl, Sequence, Memos) => {
  Object.assign(queueItem, { processing: true })

  const { account, amount, verbose } = queueItem

  Object.assign(recent, { [k]: verbose })

  setTimeout(() => {
    if (Object.keys(recent).indexOf(k) > -1) {
      delete recent[k]
    }
  }, Number(config?.localtxttl || 60) * 1000)

  const forcedClearTimeout = setTimeout(() => {
    if (Object.keys(queue).indexOf(account) > -1) {
      log('Force cleanup payout to ', account)
      delete queue[k]
    }
  }, 60 * 1000)

  try {
    Object.assign(verbose.faucet, { Sequence })

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
      Sequence,
      LastLedgerSequence: xrpl.getState().ledger.last + Number(config?.maxledgers || 10),
      ...Memos
    }

    const signed = sign(transaction, derive.familySeed(config.familyseed))

    Object.assign(verbose, { transaction, txhash: signed.id })

    logReq('Processing', verbose)

    // 9. Submit the transaction
    logReq('Submitting transaction', signed.id)
    const submit = await xrpl.send({ command: 'submit', tx_blob: signed.signedTransaction })

    if (Object.keys(recent).indexOf(k) > -1) {
      Object.assign(recent[k], { submit })
    }

    logReq('TX Submit response', signed.id, submit)
  } catch (e) {
    log(e.message)
  }

  // if (typeof xrpl !== 'undefined') {
  //   log('Closing...')
  //   await xrpl.ready()
  //   xrpl.close()
  //   log('Closed')

  //   delete queue[account]
  //   clearTimeout(forcedClearTimeout)
  //   xrpl = undefined
  // }

  log('>>> Done processing queued account', account, k)
  delete queue[k]
  clearTimeout(forcedClearTimeout)

  return
}

const main = async () => {
  app.get('/:account(r[a-zA-Z0-9]{16,})/:amount([0-9.]{1,})', async (req, res) => {
    claimCount++

    let xrpl
    const account = req.params.account
    const amount = Number(req.params.amount)

    try {
      assert(Object.keys(recent).map(r => r.split('_')[0]).indexOf(account) < 0, `This account has recently received (or attempted to receive) ${config.token}. Please wait.`)

      log('Connecting to the XRPL... <' + account + '>')

      xrpl = await new XrplClient(config?.node || 'wss://xrplcluster.com', {
        assumeOfflineAfterSeconds: 20,
        maxConnectionAttempts: 4,
        connectAttemptTimeoutSeconds: 4,
      })

      xrpl.on('clusterinfo', i => log(`Connected to FH server: ${i.preferredServer}`))
    
      xrpl.on('online', () => {
        log('XRPL connection ready <' + account + '>',
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
      
      Object.assign(queue, { [account + '_' + claimCount]: { account, amount, verbose } })
    } catch (e) {
      res.json({ error: e.message })
    }

    if (typeof xrpl !== 'undefined') {
      log('Closing... <' + account + '>')
      await xrpl.ready()
      xrpl.close()
      log('Closed <' + account + '>')
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

  app.get('/queue/length', async (req, res) => {
    const queueCount = Object.keys(queue).length
    res.json({
      queueCount,
      claimCount,
      processing,
      queueMinutes: queueCount / Number(config?.txsperledger || 5) * Number(config?.secperqueueprocess || 15)
    })
  })
      
  log('Listening at :3000')
  app.listen(3000)
}

log('Starting app...')
main()
