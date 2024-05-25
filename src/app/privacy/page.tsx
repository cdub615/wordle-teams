export default async function Page() {
  return (
    <div className='max-w-3xl mx-auto py-16 px-4 sm:px-6 lg:px-8'>
      <div className='rounded-lg shadow-lg overflow-hidden'>
        <div className='px-4 py-5 sm:px-6 bg-gray-50 dark:bg-background'>
          <h3 className='text-xl leading-6 font-medium text-gray-900 dark:text-gray-100'>Privacy Policy</h3>
        </div>
        <div className='px-4 py-5 sm:p-6'>
          <p className='text-gray-700 dark:text-gray-300 text-base'>
            Wordle Teams (&quot;us&quot;, &quot;we&quot;, or &quot;our&quot;) is committed to protecting your
            privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information
            when you use our mobile application and website (collectively, the &quot;Service&quot;). Please read
            this Privacy Policy carefully.
          </p>

          <div className='mt-6'>
            <h4 className='text-lg leading-6 font-medium text-gray-900 dark:text-gray-100'>
              Information We Collect
            </h4>
            <p className='mt-2 text-gray-700 dark:text-gray-300 text-base'>
              <strong>Account Information:</strong> When you create an account with us, we collect your name, username, email
              address, and your profile image if provided by the third-party sign-in provider you use
              (e.g., Google, Apple, Facebook, etc.).
            </p>
            <p className='mt-2 text-gray-700 dark:text-gray-300 text-base'>
              <strong>User Content:</strong> We collect the content you create, share, and store while using the
              Service, including your Wordle game scores, boards, and team information (&quot;User Content&quot;).
            </p>
            <p className='mt-2 text-gray-700 dark:text-gray-300 text-base'>
              <strong>Usage Data:</strong> We automatically collect certain information when you use the Service,
              such as your IP address, device type, operating system, browser type, and other usage data.
            </p>
          </div>

          <div className='mt-6'>
            <h4 className='text-lg leading-6 font-medium text-gray-900 dark:text-gray-100'>
              How We Use Your Information
            </h4>
            <ul className='mt-2 list-disc pl-4 text-gray-700 dark:text-gray-300 text-base'>
              <li>To provide, maintain, and improve the Service</li>
              <li>To communicate with you about your account and the Service</li>
              <li>To analyze usage trends and enhance the user experience</li>
              <li>To protect the rights, property, or safety of Wordle Teams, our users, or others</li>
            </ul>
          </div>

          <div className='mt-6'>
            <h4 className='text-lg leading-6 font-medium text-gray-900 dark:text-gray-100'>
              Information Sharing and Disclosure
            </h4>
            <p className='mt-2 text-gray-700 dark:text-gray-300 text-base'>
              We may share your information in the following circumstances:
            </p>
            <ul className='mt-2 list-disc pl-4 text-gray-700 dark:text-gray-300 text-base'>
              <li>With third-party service providers who assist us in operating the Service</li>
              <li>If required to do so by law or in response to a valid legal request</li>
              <li>To protect the rights, property, or safety of Wordle Teams, our users, or others</li>
            </ul>
          </div>

          <div className='mt-6'>
            <h4 className='text-lg leading-6 font-medium text-gray-900 dark:text-gray-100'>Data Security</h4>
            <p className='mt-2 text-gray-700 dark:text-gray-300 text-base'>
              We take reasonable steps to protect your information from unauthorized access, use, or disclosure.
              However, no method of transmission over the Internet or method of electronic storage is 100% secure.
            </p>
          </div>

          <div className='mt-6'>
            <h4 className='text-lg leading-6 font-medium text-gray-900 dark:text-gray-100'>
              Third-Party Links and Services
            </h4>
            <p className='mt-2 text-gray-700 dark:text-gray-300 text-base'>
              The Service may contain links to third-party websites or services that are not operated by us. We are
              not responsible for the privacy practices of these third parties.
            </p>
          </div>

          <div className='mt-6'>
            <h4 className='text-lg leading-6 font-medium text-gray-900 dark:text-gray-100'>
              Changes to this Privacy Policy
            </h4>
            <p className='mt-2 text-gray-700 dark:text-gray-300 text-base'>
              We may update this Privacy Policy from time to time. The updated version will be effective as soon as
              it is accessible. We encourage you to review this Privacy Policy periodically for any changes.
            </p>
          </div>

          <div className='mt-6'>
            <h4 className='text-lg leading-6 font-medium text-gray-900 dark:text-gray-100'>Contact Us</h4>
            <p className='mt-2 text-gray-700 dark:text-gray-300 text-base'>
              If you have any questions about this Privacy Policy or our privacy practices, please contact us at{' '}
              <a href='mailto:privacy@wordleteams.com' className='underline'>
                privacy@wordleteams.com
              </a>
              .
            </p>
          </div>

          <div className='mt-6'>
            <p className='text-gray-500 text-sm'>Effective Date: May 21, 2024</p>
          </div>
        </div>
      </div>
    </div>
  )
}
