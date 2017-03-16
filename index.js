require('dotenv').config()
const log = process.env.LOG
require('now-logs')(log)
const { json, send } = require('micro')
const request = require('request')
const config = require('./config');
const sendgrid = require('sendgrid')(process.env.SENDGRID_APIKEY);
const helper = require('sendgrid').mail;
const token = process.env.TOKEN
const graphQLEndpoint = process.env.GRAPHQL_ENDPOINT
const graphCoolToken = `Bearer ${process.env.GC_PAT_EMAILS}`

const makeContributionEmailBody = contribution => {

  const questionStyle = `
  display:block;
  color:#9d9d9d;
  font-weight:bold;
  font-size:18px;
  font-family:georgia, serif;
  line-height:28px;
  padding-bottom:10px;
  `;

  const answerStyle = `
  display:block;
  color:#341717;
  font-size: 14px;
  font-family: Verdana, sans-serif;
  line-height: 24px;
  padding-bottom:30px;
  `;

  let answers = '';

  contribution.answers.map(answer => {
    answers += `<span style="${questionStyle}">${answer.question.label}</span>
    <p style="${answerStyle}">${answer.answer}</p>`;
  });

  return (answers != '' ? answers : 'Could not find any Answers');
}


module.exports = async (req, res) => {

  // Get the data from the mutation
  const data = await json(req)
  console.log(data)

  // Check the token in the query string matches our env variable
  // ?token=XXX is set in the Graph.cool Mutation callback
  // in the Graph.cool Dashboard
  const { parse } = require('url');
  const { query } = parse(req.url, true)
  if (token !== query.token) {
    console.log('Token in query does not match environment variable', token, query.token)
    send(res, 400, { error: 'Token mismatch' })
  }

  // Parse Data
  const contribution = data.createdNode
  const {
    author,
    id,
    fondfolio,
    answers,
  } =  contribution

  const {
    receiver,
    title,
  } = fondfolio

  //Check if email sent already
  if (contribution.emailSent) {
    const msg = `${id} email was already sent`
    send(res, 400, { error: msg })
  }

  const from_email = new helper.Email('hello@fondfolio.com', 'Fondfolio')
  const to_email = new helper.Email('mseccafien@gmail.com', 'matt')
  const subject = `New Fondfolio Contribution for ${title}`
  const content = new helper.Content('text/html', makeContributionEmailBody(contribution));
  const mail = new helper.Mail(from_email, subject, to_email, content);
  mail.personalizations[0].addSubstitution(new helper.Substitution('-fondfolioTitle-', title));
  mail.personalizations[0].addSubstitution(new helper.Substitution('-contributorName-', author));
  mail.setTemplateId('81cc5ea2-86bd-4e09-a0aa-cb49ba706e4c')

  // Define the call back mutation that sets emailSent to True
  const mutation = `mutation {
    updateContribution(id: "${id}", emailSent: true) {
      id
    }
  }`

  // Define the request to SendGrid
  const requestToSg = sendgrid.emptyRequest({
    method: 'POST',
    path: '/v3/mail/send',
    body: mail.toJSON()
  })

  // Fire the request to SendGrid
  sendgrid.API(requestToSg, (error, response) => {
    if (error) {
      console.log(error)
      send(res, 400, { error: `Contribution email for ${id} was not sent. ${error}` })
    }
    // Fire the request to Graph.cool endpoint
    const requestConfig = {
      url: graphQLEndpoint,
      headers: {
        'Authorization' : graphCoolToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify({query: mutation}),
    }
    console.log('Updating GraphCool contribution emailSent', requestConfig)
    request.post(requestConfig).on('error', e => {
      const msg = `Contribution email error on ${id}`
      console.log(e)
      console.log(msg)
      send(res, 400, { error: msg })
    }).on('response', r => {
      const msg = `Contribution ${id} was sent`
      console.log(msg)
      send(res, 200, { message: msg })
    })

  })
}
