import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Preview,
  render,
  Section,
  Tailwind,
  Text,
} from '@react-email/components'
import { ControlSchema, PayloadSchema } from '../workflows/board-entry-reminder'

type BoardEntryReminderProps = ControlSchema & PayloadSchema

export const BoardEntryReminderEmail = ({
  previewText,
  worldleTeamsImg,
  wtIconImg,
  email,
  firstName,
}: BoardEntryReminderProps) => {
  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Tailwind>
        <Body className='bg-white my-auto mx-auto font-sans'>
          <Container className='rounded my-[40px] mx-auto p-[20px] max-w-xl'>
            <Section className='mt-[32px]'>
              <Img src={worldleTeamsImg} width='400' alt='Wordle Teams' className='my-0 mx-auto rounded' />
            </Section>
            <Heading className='text-black text-4xl font-normal text-center p-0 my-[30px] mx-0'>
              Reminder to enter your Wordle board into <strong>Wordle Teams</strong>
            </Heading>
            <Text className='text-black text-xl leading-2'>Hello {firstName},</Text>
            <Text className='text-black text-xl mb-6'>
              It looks like you have not yet entered your Wordle board for today. Don't miss out on those potential
              points!
            </Text>
            <Text className='text-black text-xl'>Best of luck!</Text>
            <Img className='rounded-full' src={wtIconImg} width='32' height='32' />
            <Text className='text-black text-lg'>Wordle Teams</Text>
            <Hr className='border border-solid border-[#eaeaea] my-[26px] mx-0 w-full' />
            <Text className='text-[#858585] text-sm leading-[24px]'>
              This invitation was intended for <span className='text-black'>{email}</span>. If you were not
              expecting this invitation, you can ignore this email.
            </Text>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  )
}

export default BoardEntryReminderEmail

export function renderEmail(controls: ControlSchema, payload: PayloadSchema) {
  return render(<BoardEntryReminderEmail {...controls} {...payload} />)
}