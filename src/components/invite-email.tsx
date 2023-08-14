import * as React from 'react';

interface EmailTemplateProps {
  firstName: string;
}

const InviteEmail: React.FC<Readonly<EmailTemplateProps>> = ({
  firstName,
}) => (
  <div>
    <h1>Welcome to Wordle Teams!</h1>
    <div>You have been invited to join a team.</div>
    <div>Head to wordleteams.vercel.app to get started!</div>
  </div>
);

export default InviteEmail