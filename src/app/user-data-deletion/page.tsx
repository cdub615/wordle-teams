export default async function Page() {
  return (
    <div className='max-w-3xl mx-auto py-16 px-4 sm:px-6 lg:px-8'>
      <div className='rounded-lg shadow-lg overflow-hidden'>
        <div className='px-4 py-5 sm:px-6 bg-gray-50 dark:bg-background'>
          <h3 className='text-xl leading-6 font-medium text-gray-900 dark:text-gray-100'>User Data Deletion</h3>
        </div>
        <div className='px-4 py-5 sm:p-6'>
          <p className='text-gray-700 dark:text-gray-300 text-base'>
            At Wordle Teams, we respect your privacy and give you control over your personal data. If you wish to
            have your account and all associated data permanently deleted from our systems, you can submit a
            request by following the instructions below.
          </p>

          <div className='mt-6'>
            <h4 className='text-lg leading-6 font-medium text-gray-900 dark:text-gray-100'>How to Request Data Deletion</h4>
            <p className='mt-2 text-gray-700 dark:text-gray-300 text-base'>
              To request the deletion of your account and personal data, please send an email to{' '}
              <a href='mailto:support@wordleteams.com' className='underline'>
                support@wordleteams.com
              </a>{' '}
              with the subject line &quot;Request for Data Deletion&quot;.
            </p>
            <p className='mt-2 text-gray-700 dark:text-gray-300 text-base'>In the email, please include the following information:</p>
            <ul className='mt-2 list-disc pl-4 text-gray-700 dark:text-gray-300 text-base'>
              <li>Your full name</li>
              <li>The email address associated with your Wordle Teams account</li>
              <li>
                A brief statement confirming your request to permanently delete your account and all associated
                data
              </li>
            </ul>
          </div>

          <div className='mt-6'>
            <h4 className='text-lg leading-6 font-medium text-gray-900 dark:text-gray-100'>Processing Your Request</h4>
            <p className='mt-2 text-gray-700 dark:text-gray-300 text-base'>
              Once we receive your request, we will verify your identity and process the deletion of your account
              and data within a reasonable timeframe. Please note that after your data is deleted, it cannot be
              recovered, and you will no longer have access to your account or any associated information.
            </p>
          </div>

          <div className='mt-6'>
            <p className='text-gray-500 text-sm'>Last Updated: May 22, 2024</p>
          </div>
        </div>
      </div>
    </div>
  )
}
