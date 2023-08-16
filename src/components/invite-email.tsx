import {
  Body,
  Button,
  Column,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Row,
  Section,
  Tailwind,
  Text,
} from '@react-email/components'
import * as React from 'react'

interface EmailTemplateProps {
  email: string
  invitedByUsername: string
  invitedByEmail: string
  teamName: string
  logo: string
  userImage: string
  teamImage: string
  inviteFromIp?: string
  inviteFromCity?: string
  inviteFromCountry?: string
  inviteFromRegion?: string
}

const baseUrl = process.env.VERCEL_URL!

const InviteEmail: React.FC<Readonly<EmailTemplateProps>> = ({
  email,
  invitedByUsername,
  invitedByEmail,
  teamName,
  logo,
  userImage,
  teamImage,
  inviteFromIp,
  inviteFromCity,
  inviteFromCountry,
  inviteFromRegion,
}) => {
  const previewText = `Join ${invitedByUsername} on Wordle Teams`
  const inviteLink = baseUrl
  const username = email.substring(0, email.indexOf('@'))
  const inviteFromLocation = `${inviteFromCity}, ${inviteFromCountry}, ${inviteFromRegion}`
  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Tailwind>
        <Body className='bg-black my-auto mx-auto font-sans'>
          <Container className='my-[40px] mx-auto p-[20px] w-[465px]'>
            <Section className='mt-[32px]'>
              <Img src={logo} width='400' alt='Wordle Teams' className='my-0 mx-auto rounded' />
            </Section>
            <Heading className='text-white text-[24px] font-normal text-center p-0 my-[30px] mx-0'>
              Join <strong>{teamName}</strong> on <strong>Wordle Teams</strong>
            </Heading>
            <Text className='text-white text-[14px] leading-[24px]'>Hello {username},</Text>
            <Text className='text-white text-[14px] leading-[24px]'>
              <strong>{invitedByUsername}</strong> (
              <Link href={`mailto:${invitedByEmail}`} className='text-indigo-600 no-underline'>
                {invitedByEmail}
              </Link>
              ) has invited you to the <strong>{teamName}</strong> team on <strong>Wordle Teams</strong>.
            </Text>
            <Section>
              <Row>
                <Column align='right'>
                  <Img
                    className='rounded-full'
                    src={userImage}
                    width='64'
                    height='64'
                  />
                </Column>
                <Column align='center'>
                  <Text className='text-lg'>&rarr;</Text>
                </Column>
                <Column align='left'>
                  <Img
                    className='rounded-full'
                    src={teamImage}
                    width='64'
                    height='64'
                  />
                </Column>
              </Row>
            </Section>
            <Section className='text-center mt-[32px] mb-[32px]'>
              <Button
                pX={20}
                pY={12}
                className='border border-solid border-black rounded text-white text-[12px] font-semibold no-underline text-center'
                href={inviteLink}
              >
                Join the team
              </Button>
            </Section>
            <Text className='text-white text-[14px] leading-[24px]'>
              or copy and paste this URL into your browser:{' '}
              <Link href={inviteLink} className='text-indigo-600 no-underline'>
                {inviteLink}
              </Link>
            </Text>
            <Hr className='border border-solid border-[#eaeaea] my-[26px] mx-0 w-full' />
            <Text className='text-[#858585] text-[12px] leading-[24px]'>
              This invitation was intended for <span className='text-white font-bold'>{username}</span>.
              {!!inviteFromIp && (
                <>
                  This invite was sent from <span className='text-white font-bold'>{inviteFromIp}</span> located in{' '}
                  <span className='text-white font-bold'>{inviteFromLocation}</span>.
                </>
              )}{' '}
              If you were not expecting this invitation, you can ignore this email. If you are concerned about your
              account's safety, please reply to this email to get in touch with us.
            </Text>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  )
}

export default InviteEmail
